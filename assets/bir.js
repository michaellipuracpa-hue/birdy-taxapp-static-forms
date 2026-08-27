/* ============================================================
   BIR Tax App — shared form engine
   - Injects a toolbar (records: new / duplicate / rename / delete,
     Save, Save and File, Export as PDF)
   - Persists every [name] field to localStorage per form & record
   - Filing workflow: Draft → FILED (locked) → Amended return → AMENDED
     A filed record is locked; editing it requires either confirming it
     was NOT actually filed (unlock) or creating an amended return.
   - Auto-computations: any input with data-calc="expression" is
     recomputed whenever a field changes. Inside expressions use
     n('field') for numbers, v('field') for radio/select values,
     gradTax(ti, year) for the graduated income tax table.
   - Number fields: class="num" get comma-grouping on blur.
   - Integration API for host apps (e.g. Manus): window.BIRForm — see
     the bottom of this file and HANDOVER-MANUS.md.
   ============================================================ */
(function () {
  "use strict";

  var FORM_ID = document.body.dataset.form || location.pathname.split("/").pop().replace(".html", "");
  var KEY = "birtax:" + FORM_ID;
  var state = load() || { current: "Record 1", records: { "Record 1": {} } };
  var saveTimer = null;

  /* ---------------- storage & record model ----------------
     Record shape: { data: {field: value}, status: "draft"|"filed"|"amended",
                     filedAt: ISO string|null, amendedFrom: record name|null }
     (Older saves stored the flat data object — migrated below.) */
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
  }
  Object.keys(state.records).forEach(function (k) {
    var r = state.records[k];
    if (!r || typeof r !== "object" || typeof r.data !== "object" || !("status" in r)) {
      state.records[k] = { data: (r && typeof r === "object") ? r : {}, status: "draft", filedAt: null, amendedFrom: null };
    }
  });
  function newRecord(data, amendedFrom) {
    return { data: data || {}, status: "draft", filedAt: null, amendedFrom: amendedFrom || null };
  }
  function cur() {
    if (!state.records[state.current]) state.current = Object.keys(state.records)[0];
    return state.records[state.current];
  }
  function isLocked() { var s = cur().status; return s === "filed" || s === "amended"; }
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      setStatus("Saved");
    } catch (e) { setStatus("Save failed"); }
  }

  /* ---------------- field helpers ---------------- */
  function fields() {
    return Array.prototype.slice.call(document.querySelectorAll("[name]"));
  }
  function collect() {
    var data = {};
    fields().forEach(function (el) {
      if (el.type === "checkbox") data[el.name] = el.checked;
      else if (el.type === "radio") { if (el.checked) data[el.name] = el.value; }
      else data[el.name] = el.value;
    });
    return data;
  }
  function apply(data) {
    data = data || {};
    fields().forEach(function (el) {
      var has = Object.prototype.hasOwnProperty.call(data, el.name);
      if (el.type === "checkbox") el.checked = has ? !!data[el.name] : el.defaultChecked;
      else if (el.type === "radio") el.checked = has ? data[el.name] === el.value : el.defaultChecked;
      // fall back to the HTML value="…" prefill (e.g. statutory rate boxes) for unsaved fields
      else el.value = has && data[el.name] != null ? data[el.name] : el.defaultValue;
    });
    recalc();
  }
  function saveCurrent() {
    cur().data = collect();
  }

  /* ---------------- numbers & calculations ---------------- */
  function parseNum(v) {
    if (v == null) return 0;
    v = String(v).replace(/,/g, "").replace(/[()]/g, function (m) { return m === "(" ? "-" : ""; }).trim();
    var x = parseFloat(v);
    return isNaN(x) ? 0 : x;
  }
  function fmt(x) {
    if (x === 0) return "0.00";
    return x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // expression helper: n('fieldName')
  function n(name) {
    var el = document.querySelector('[name="' + name + '"]');
    return el ? parseNum(el.value) : 0;
  }
  window.n = n; // expressions rely on it

  // radio/select value helper for data-calc: v('fieldName') -> string value ('' if none)
  function v(name) {
    var els = document.querySelectorAll('[name="' + name + '"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.type === "radio") { if (el.checked) return el.value; }
      else if (el.type === "checkbox") { return el.checked ? (el.value || "on") : ""; }
      else return el.value;
    }
    return "";
  }
  window.v = v;

  /* Philippine graduated income tax (TRAIN, RA 10963).
     gradTax(taxableIncome, year) — uses the 2023-onward schedule when
     year >= 2023 (or when year is blank/invalid), else the 2018–2022 schedule.
     Callable from data-calc expressions, e.g. data-calc="gradTax(n('net_taxable'), n('year'))" */
  window.gradTax = function (ti, year) {
    ti = parseNum(ti);
    if (ti <= 0) return 0;
    var y = parseInt(year, 10);
    if (!y || y < 1900) y = new Date().getFullYear();
    // [upper bound, tax at lower bound, marginal rate]
    var t = (y >= 2023)
      ? [[250000, 0, 0], [400000, 0, .15], [800000, 22500, .20], [2000000, 102500, .25], [8000000, 402500, .30], [Infinity, 2202500, .35]]
      : [[250000, 0, 0], [400000, 0, .20], [800000, 30000, .25], [2000000, 130000, .30], [8000000, 490000, .32], [Infinity, 2410000, .35]];
    var lo = 0;
    for (var i = 0; i < t.length; i++) {
      if (ti <= t[i][0]) return t[i][1] + (ti - lo) * t[i][2];
      lo = t[i][0];
    }
    return 0;
  };

  function recalc() {
    var calcEls = document.querySelectorAll("[data-calc]");
    // run 3 passes so chained calcs settle (totals of totals)
    for (var pass = 0; pass < 3; pass++) {
      calcEls.forEach(function (el) {
        try {
          var val = Function("n", "return (" + el.dataset.calc + ");")(n);
          if (typeof val === "number" && isFinite(val)) el.value = fmt(val);
          else if (val != null) el.value = val;
        } catch (e) { /* leave as-is */ }
      });
    }
  }
  window.birRecalc = recalc;

  /* ---------------- small UI helpers ---------------- */
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text) e.textContent = text;
    return e;
  }
  var statusEl;
  function setStatus(msg) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    clearTimeout(setStatus._t);
    setStatus._t = setTimeout(function () { statusEl.textContent = ""; }, 2500);
  }

  /* Generic modal. buttons: [{label, kind:'primary'|'danger'|'', onClick(close)}] */
  function modal(title, bodyHTML, buttons) {
    var wrap = el("div", { class: "no-print bir-modal", style:
      "position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;" });
    var box = el("div", { style:
      "background:#fff;max-width:460px;border-radius:8px;padding:20px 22px;font-size:13px;line-height:1.5;box-shadow:0 8px 30px rgba(0,0,0,.35);color:#1c2430;" });
    box.innerHTML = "<div style='font-size:15px;font-weight:700;margin-bottom:8px'>" + title + "</div>" + bodyHTML;
    var btns = el("div", { style: "display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap" });
    function close() { if (wrap.parentNode) document.body.removeChild(wrap); }
    (buttons || []).forEach(function (b) {
      var style = "font:inherit;padding:6px 14px;border-radius:5px;cursor:pointer;";
      if (b.kind === "primary") style += "border:none;background:#1a3e72;color:#fff;font-weight:600;";
      else if (b.kind === "danger") style += "border:none;background:#c73838;color:#fff;font-weight:600;";
      else if (b.kind === "success") style += "border:none;background:#1e7d3c;color:#fff;font-weight:600;";
      else style += "border:1px solid #bbb;background:#fff;";
      var btn = el("button", { style: style }, b.label);
      btn.addEventListener("click", function () { b.onClick ? b.onClick(close) : close(); });
      btns.appendChild(btn);
    });
    box.appendChild(btns);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    return { close: close, box: box };
  }

  /* ---------------- filing workflow ---------------- */
  var badgeEl, btnFileRef, refreshSelRef;

  function statusLabel(r) {
    if (r.status === "filed") return "FILED";
    if (r.status === "amended") return "AMENDED";
    return r.amendedFrom ? "AMENDMENT DRAFT" : "DRAFT";
  }
  function refreshBadge() {
    if (!badgeEl) return;
    var r = cur();
    badgeEl.className = "tb-badge " + r.status + (r.amendedFrom && r.status === "draft" ? " amend-draft" : "");
    var when = r.filedAt ? " · " + new Date(r.filedAt).toLocaleDateString() : "";
    badgeEl.textContent = statusLabel(r) + when;
    badgeEl.title = r.amendedFrom ? "Amended return of “" + r.amendedFrom + "”" : "";
    if (btnFileRef) btnFileRef.style.display = isLocked() ? "none" : "";
  }
  function setLock() {
    var locked = isLocked();
    document.body.classList.toggle("bir-locked", locked);
    fields().forEach(function (f) { f.disabled = locked; });
    refreshBadge();
  }
  function amendmentName(base) {
    var name = base + " (Amended)", i = 2;
    while (state.records[name]) name = base + " (Amended " + i++ + ")";
    return name;
  }

  function doFile() {
    saveCurrent();
    var r = cur();
    r.status = r.amendedFrom ? "amended" : "filed";
    r.filedAt = new Date().toISOString();
    persist();
    setLock();
    setStatus(statusLabel(r));
  }
  function doUnlock() {
    var r = cur();
    r.status = "draft";
    r.filedAt = null;
    persist();
    setLock();
    setStatus("Unlocked — Draft");
  }
  function doCreateAmendment() {
    saveCurrent();
    var from = state.current;
    var name = amendmentName(from);
    state.records[name] = newRecord(JSON.parse(JSON.stringify(cur().data)), from);
    state.current = name;
    apply(state.records[name].data);
    if (refreshSelRef) refreshSelRef();
    persist();
    setLock();
    return name;
  }

  function showFileConfirm() {
    if (isLocked()) { showLockedDialog(); return; }
    var r = cur();
    var willBe = r.amendedFrom ? "AMENDED" : "FILED";
    var amendNote = r.amendedFrom
      ? "<div style='background:#fff3cd;border:1px solid #e6c97a;border-radius:5px;padding:8px 10px;margin-top:8px'>This is an <b>amended return</b> of “" + r.amendedFrom +
        "”. Make sure <b>“Amended Return?” is marked YES</b> on the form before filing.</div>"
      : "";
    modal("Save and File — final confirmation",
      "<div>You are about to mark <b>“" + state.current + "”</b> as <b>" + willBe + "</b>.</div>" +
      "<div style='margin-top:8px'>Please confirm that <b>all details are final</b>. Once " + willBe +
      ", this form is <b>locked</b> and you can no longer make changes to it.</div>" +
      "<div style='margin-top:8px;font-size:12px;color:#555'>If it turns out this return was not actually filed, you can unlock it later by confirming that. " +
      "Changes to a genuinely filed return require an amended return.</div>" + amendNote,
      [
        { label: "Cancel" },
        { label: "Confirm — Save and File", kind: "success", onClick: function (close) { close(); doFile(); } }
      ]);
  }

  function showLockedDialog() {
    var r = cur();
    var filedOn = r.filedAt ? new Date(r.filedAt).toLocaleString() : "";
    modal("Form locked — already " + statusLabel(r).toLowerCase(),
      "<div><b>“" + state.current + "”</b> was marked <b>" + statusLabel(r) + "</b>" + (filedOn ? " on " + filedOn : "") + ".</div>" +
      "<div style='margin-top:8px'>This form is <b>locked for changes</b> because it has already been filed. " +
      "If you need to change it, create an <b>amended return</b> — or unlock it only if it has <b>not</b> actually been filed.</div>",
      [
        { label: "Close" },
        { label: "Not filed yet — unlock", onClick: function (close) {
            close();
            modal("Confirm: not yet filed",
              "<div>Please confirm that <b>“" + state.current + "”</b> has <b>NOT</b> been filed with the BIR/eFPS/eBIRForms/AAB.</div>" +
              "<div style='margin-top:8px'>It will revert to <b>Draft</b> and be unlocked for editing.</div>",
              [
                { label: "Cancel" },
                { label: "Confirm — it has not been filed", kind: "danger", onClick: function (c2) { c2(); doUnlock(); } }
              ]);
          } },
        { label: "Create amended return", kind: "primary", onClick: function (close) {
            close();
            var name = doCreateAmendment();
            modal("Amended return created",
              "<div><b>“" + name + "”</b> was created as a copy of the filed return and is now the active record (Draft, unlocked).</div>" +
              "<div style='margin-top:8px'>Remember to mark <b>“Amended Return?” = YES</b> on the form. " +
              "When you click <b>Save and File</b> on it, it will be marked <b>AMENDED</b>.</div>",
              [{ label: "OK", kind: "primary" }]);
          } }
      ]);
  }

  /* ---------------- toolbar ---------------- */
  function buildToolbar() {
    var bar = el("div", { class: "bir-toolbar" });
    var back = el("a", { href: "../index.html" }, "← Tax App");
    var title = el("span", { class: "tb-title" }, document.title);

    var sel = el("select", { title: "Saved records" });
    function refreshSel() {
      sel.innerHTML = "";
      Object.keys(state.records).sort().forEach(function (name) {
        var r = state.records[name];
        var tag = r.status === "filed" ? " ✓ FILED" : r.status === "amended" ? " ✓ AMENDED" : "";
        var o = el("option", { value: name }, name + tag);
        if (name === state.current) o.selected = true;
        sel.appendChild(o);
      });
    }
    refreshSelRef = refreshSel;
    sel.addEventListener("change", function () {
      if (!isLocked()) saveCurrent();
      state.current = sel.value;
      apply(cur().data);
      setLock();
      persist();
    });

    var btnNew = el("button", {}, "+ New record");
    btnNew.addEventListener("click", function () {
      var name = prompt("Name for the new record (e.g. \"ABC Corp – Q1 2026\"):", "Record " + (Object.keys(state.records).length + 1));
      if (!name) return;
      if (state.records[name]) { alert("A record with that name already exists."); return; }
      if (!isLocked()) saveCurrent();
      state.records[name] = newRecord();
      state.current = name;
      apply({});
      refreshSel(); setLock(); persist();
    });

    var btnCopy = el("button", {}, "Duplicate");
    btnCopy.addEventListener("click", function () {
      var name = prompt("Save a copy of “" + state.current + "” as:", state.current + " (copy)");
      if (!name || state.records[name]) return;
      if (!isLocked()) saveCurrent();
      state.records[name] = newRecord(JSON.parse(JSON.stringify(cur().data)));
      state.current = name;
      apply(cur().data);
      refreshSel(); setLock(); persist();
    });

    var btnRen = el("button", {}, "Rename");
    btnRen.addEventListener("click", function () {
      var name = prompt("Rename record:", state.current);
      if (!name || name === state.current || state.records[name]) return;
      state.records[name] = state.records[state.current];
      delete state.records[state.current];
      // keep amendedFrom pointers of other records in sync
      Object.keys(state.records).forEach(function (k) {
        if (state.records[k].amendedFrom === state.current) state.records[k].amendedFrom = name;
      });
      state.current = name;
      refreshSel(); persist();
    });

    var btnDel = el("button", { class: "danger" }, "Delete");
    btnDel.addEventListener("click", function () {
      var warn = isLocked() ? " This record is marked " + statusLabel(cur()) + "." : "";
      if (!confirm("Delete record “" + state.current + "”?" + warn + " This cannot be undone.")) return;
      delete state.records[state.current];
      var names = Object.keys(state.records);
      if (!names.length) { state.records["Record 1"] = newRecord(); names = ["Record 1"]; }
      state.current = names[0];
      apply(cur().data);
      refreshSel(); setLock(); persist();
    });

    var btnClear = el("button", {}, "Clear form");
    btnClear.addEventListener("click", function () {
      if (isLocked()) { showLockedDialog(); return; }
      if (!confirm("Clear all fields of “" + state.current + "”?")) return;
      cur().data = {};
      apply({});
      persist();
    });

    badgeEl = el("span", { class: "tb-badge" });

    var btnSave = el("button", {}, "💾 Save");
    btnSave.addEventListener("click", function () {
      if (isLocked()) { showLockedDialog(); return; }
      saveCurrent(); persist();
    });

    var btnFile = el("button", { class: "file" }, "Save and File");
    btnFile.addEventListener("click", showFileConfirm);
    btnFileRef = btnFile;

    var btnPdf = el("button", { class: "primary" }, "⬇ Export as PDF");
    btnPdf.addEventListener("click", function () {
      if (!isLocked()) { saveCurrent(); persist(); }
      showPrintChecklist(printAs);
    });

    statusEl = el("span", { class: "tb-status" });

    bar.appendChild(back);
    bar.appendChild(title);
    bar.appendChild(el("span", {}, "Record:"));
    bar.appendChild(sel);
    bar.appendChild(btnNew);
    bar.appendChild(btnCopy);
    bar.appendChild(btnRen);
    bar.appendChild(btnDel);
    bar.appendChild(btnClear);
    bar.appendChild(badgeEl);
    bar.appendChild(btnSave);
    bar.appendChild(btnFile);
    bar.appendChild(btnPdf);
    bar.appendChild(statusEl);
    refreshSel();
    document.body.insertBefore(bar, document.body.firstChild);
  }

  /* ---------------- PDF filename builder ----------------
     Naming convention: YYYY-MM-Month-Form-Client - AmountDue
     e.g. 2026-08-August-2551Q-MSL CPAs & Co - 00.00
     The browser's Save-as-PDF dialog pre-fills from document.title,
     so the title is swapped to this name during printing.
     Per-form sources: c = client-name field, a = amount-due field,
     m = month field (MM/YYYY), d = full date (MM/DD/YYYY),
     y = year field, q = quarter radio (month = last month of quarter). */
  var FILE_META = {
    "0605":    { c: "taxpayer_name",   a: "total_amount_payable",     d: "return_period" },
    "0611-A":  { c: "taxpayer_name",   a: "total_amount_payable",     d: "return_period" },
    "0619-E":  { c: "agent_name",      a: "total_remittance",         m: "month_of" },
    "0619-F":  { c: "agent_name",      a: "total_remittance",         m: "month_of" },
    "1600-PT": { c: "agent_name",      a: "total_amount_due",         m: "for_month" },
    "1600-VT": { c: "agent_name",      a: "i27",                      m: "month" },
    "1601-C":  { c: "p1_agent_name",   a: "p2_36_total_amount_due",   m: "p0_month" },
    "1601-EQ": { c: "agent_name",      a: "total_amount_due",         y: "year", q: "quarter" },
    "1601-FQ": { c: "agent_name",      a: "total_amount_due",         y: "year", q: "quarter" },
    "1603Q":   { c: "agent_name",      a: "total_amount_due",         y: "year", q: "quarter" },
    "1604-C":  { c: "p1_agent_name",   a: "p2b_total_remitted",       y: "p0_year" },
    "1604-E":  { c: "agent_name",      a: "s1_total_amount",          y: "year" },
    "1604-F":  { c: "agent_name",      a: "s1_total_remitted",        y: "year" },
    "1606":    { c: "buyer_a_name",    a: "total_payable",            d: "transaction_date" },
    "1700":    { c: "name",            a: "i36",                      y: "year" },
    "1701":    { c: "name",            a: "i32",                      y: "year" },
    "1701A":   { c: "name",            a: "i30",                      y: "year" },
    "1701-MS": { c: "name_a",          a: "i30",                      y: "year" },
    "1701Q":   { c: "name",            a: "i31",                      y: "year", q: "quarter" },
    "1702-RT": { c: "reg_name",        a: "i21",                      m: "year_ended" },
    "1702-EX": { c: "reg_name",        a: "i22",                      m: "year_ended" },
    "1702-MX": { c: "reg_name",        a: "i21",                      m: "year_ended" },
    "1702Q":   { c: "reg_name",        a: "i25",                      y: "year_ended", q: "quarter" },
    "2121":    { c: "taxpayer_name",   a: "total_abatement",          d: "return_period" },
    "2306":    { c: "p1_3_payee_name", a: "fwt_total_tax",            d: "p0_1_period_to" },
    "2307":    { c: "p1_3_payee_name", a: "ewt_total_total",          d: "p0_1_period_to" },
    "2316":    { c: "p1_4_employee_name", a: "p4a_28_total_taxes_withheld", y: "p0_year" },
    "2550Q":   { c: "taxpayer_name",   a: "i26",                      y: "year_ended", q: "quarter" },
    "2550-DS": { c: "registered_name", a: "i25",                      y: "year_ended", q: "quarter" },
    "2551Q":   { c: "taxpayer_name",   a: "total_amount_payable",     y: "year_ended", q: "quarter" }
  };
  var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  function fieldVal(name) {
    if (!name) return "";
    return String(v(name) || "").trim();
  }
  function buildFilename() {
    var meta = FILE_META[FORM_ID] || {};
    var now = new Date();
    var mm = 0, yyyy = 0;
    // month/date fields carry both month and year
    var mv = fieldVal(meta.m) || fieldVal(meta.d);
    var ym = mv.match(/(\d{1,2})\s*[\/\-.]\s*(?:\d{1,2}\s*[\/\-.]\s*)?(\d{4}|\d{2})/);
    if (ym) {
      mm = parseInt(ym[1], 10);
      yyyy = parseInt(ym[2], 10);
      if (yyyy < 100) yyyy += 2000;
    }
    if (!yyyy && meta.y) {
      var yv = fieldVal(meta.y).match(/\d{4}/);
      if (yv) yyyy = parseInt(yv[0], 10);
    }
    if (!mm && meta.q) {
      var qv = fieldVal(meta.q).toLowerCase();
      var qn = /4|fourth/.test(qv) ? 4 : /3|third/.test(qv) ? 3 : /2|second/.test(qv) ? 2 : /1|first/.test(qv) ? 1 : 0;
      if (qn) mm = qn * 3; // last month of the calendar quarter
    }
    if (!yyyy) yyyy = now.getFullYear();
    if (!mm || mm > 12) mm = meta.q || meta.m || meta.d ? now.getMonth() + 1 : 12; // annual forms default to December
    var client = fieldVal(meta.c) || "Client";
    var amount = fieldVal(meta.a) || "00.00";
    if (amount === "0.00") amount = "00.00";
    var suffix = cur().status === "amended" || cur().amendedFrom ? " - Amended" : "";
    var name = yyyy + "-" + (mm < 10 ? "0" + mm : mm) + "-" + MONTHS[mm - 1] + "-" + FORM_ID + "-" + client + " - " + amount + suffix;
    return name.replace(/[\\\/:*?"<>|]/g, "-");
  }

  /* ---------------- BIR print-settings checklist ----------------
     Paper size and margins are set by @page in bir.css (folio 8.5×13,
     L .146 / R .148 / T .14 / B .14). Scale and headers/footers can only
     be set in the browser's print dialog, so remind the user once. */
  var HINT_KEY = "birtax:printHintDismissed";
  function printAs(filename) {
    var original = document.title;
    document.title = filename; // Save-as-PDF dialogs pre-fill the filename from the title
    var restore = function () { document.title = original; window.removeEventListener("afterprint", restore); };
    window.addEventListener("afterprint", restore);
    setTimeout(restore, 60000); // safety net if afterprint never fires
    window.print();
  }
  function showPrintChecklist(proceed) {
    var dismissed = false;
    try { dismissed = localStorage.getItem(HINT_KEY) === "1"; } catch (e) {}
    if (dismissed) { proceed(buildFilename()); return; }

    var m = modal("BIR print settings",
      "<div>Paper size and margins are already set by the form " +
      "(<b>Folio 8.5\" × 13\"</b>, portrait — per RMC 44-2023 / 51-2024). " +
      "In the print dialog that opens next, check only:</div>" +
      "<ul style='margin:10px 0;padding-left:20px'>" +
      "<li><b>Destination:</b> Save as PDF (or your printer, folio/legal bond paper)</li>" +
      "<li><b>Paper size:</b> 8.5 × 13 in (folio) — or Legal if folio is not listed</li>" +
      "<li><b>Scale:</b> 100% / Default / \"Actual size\" — <b>never</b> shrink-to-fit or fit-to-page</li>" +
      "<li><b>Headers and footers:</b> OFF</li>" +
      "<li><b>Margins:</b> Default (the form supplies the official margins)</li>" +
      "</ul>" +
      "<div style='margin:0 0 10px'><b>File name</b> <span style='color:#777;font-size:11px'>(pre-fills the Save As box — edit if needed, e.g. add “ - v2”)</span>" +
      "<input type='text' id='bir-filename' style='width:100%;margin-top:4px;font:inherit;font-size:12px;padding:5px 7px;border:1px solid #bbb;border-radius:4px;box-sizing:border-box'></div>" +
      "<label style='display:flex;align-items:center;gap:6px;font-size:12px;color:#555'>" +
      "<input type='checkbox' id='bir-hint-skip'> Don't show this again (file name will still be applied automatically)</label>",
      [
        { label: "Cancel" },
        { label: "Continue to print", kind: "primary", onClick: function (close) {
            var box = document.getElementById("bir-filename");
            var fn = (box && box.value.trim()) || buildFilename();
            if (document.getElementById("bir-hint-skip").checked) {
              try { localStorage.setItem(HINT_KEY, "1"); } catch (e) {}
            }
            close();
            setTimeout(function () { proceed(fn); }, 50);
          } }
      ]);
    m.box.querySelector("#bir-filename").value = buildFilename();
  }

  /* ---------------- wire up ---------------- */
  function init() {
    buildToolbar();
    apply(cur().data);
    setLock();

    document.addEventListener("input", function (e) {
      if (!e.target.name && !e.target.dataset.calc) return;
      if (isLocked()) return; // fields are disabled, but guard anyway
      recalc();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { saveCurrent(); persist(); }, 600);
    });
    document.addEventListener("blur", function (e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains("num") && !t.readOnly && !t.disabled && t.value.trim() !== "") {
        t.value = fmt(parseNum(t.value));
      }
    }, true);
    // clicking a locked form notifies the user instead of silently doing nothing
    document.addEventListener("mousedown", function (e) {
      if (!isLocked()) return;
      if (e.target.closest(".bir-toolbar") || e.target.closest(".bir-modal")) return;
      if (e.target.closest("input, select, textarea, label")) showLockedDialog();
    }, true);

    recalc();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  /* ---------------- integration API (for host apps, e.g. Manus) ----------------
     See HANDOVER-MANUS.md. All methods operate on the ACTIVE record. */
  window.BIRForm = {
    formId: FORM_ID,
    /** all field values of the active record, {name: value} */
    getData: function () { return collect(); },
    /** merge values into the form (throws if the record is filed/locked unless opts.force) */
    setData: function (obj, opts) {
      if (isLocked() && !(opts && opts.force)) throw new Error("Record “" + state.current + "” is " + statusLabel(cur()) + " (locked). Unlock or create an amendment first.");
      var merged = collect();
      Object.keys(obj || {}).forEach(function (k) { merged[k] = obj[k]; });
      apply(merged); saveCurrent(); persist();
    },
    setField: function (name, value, opts) { var o = {}; o[name] = value; window.BIRForm.setData(o, opts); },
    recalc: recalc,
    /** status of the active record */
    getRecord: function () {
      var r = cur();
      return { name: state.current, status: r.status, filedAt: r.filedAt, amendedFrom: r.amendedFrom, locked: isLocked() };
    },
    listRecords: function () {
      return Object.keys(state.records).map(function (k) {
        var r = state.records[k];
        return { name: k, status: r.status, filedAt: r.filedAt, amendedFrom: r.amendedFrom };
      });
    },
    selectRecord: function (name) {
      if (!state.records[name]) throw new Error("No record named “" + name + "”");
      if (!isLocked()) saveCurrent();
      state.current = name; apply(cur().data);
      if (refreshSelRef) refreshSelRef();
      setLock(); persist();
    },
    createRecord: function (name, data) {
      if (state.records[name]) throw new Error("Record “" + name + "” already exists");
      if (!isLocked()) saveCurrent();
      state.records[name] = newRecord(data || {});
      state.current = name; apply(cur().data);
      if (refreshSelRef) refreshSelRef();
      setLock(); persist();
    },
    /** mark the active record FILED (or AMENDED if it is an amendment) — no dialog */
    file: function () { if (isLocked()) throw new Error("Already " + statusLabel(cur())); doFile(); },
    /** revert a filed record to Draft — caller confirms it was NOT actually filed */
    unfile: function () { doUnlock(); },
    /** duplicate the active (filed) record as an amendment draft; returns its name */
    createAmendment: function () { return doCreateAmendment(); },
    suggestedFilename: function () { return buildFilename(); },
    /** open the print dialog with the standard filename applied */
    print: function () { printAs(buildFilename()); }
  };
})();
