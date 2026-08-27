# BIR Tax App — form page build spec

Every form page lives in `/Users/michaellipura/Downloads/BIR Tax Returns/Tax App/forms/<FORM>.html`
and must follow these conventions exactly.

## Skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>BIR 1701Q — Quarterly Income Tax Return</title>
<link rel="stylesheet" href="../assets/bir.css">
<script src="../assets/bir.js" defer></script>
</head>
<body data-form="1701Q">

<div class="sheet">
  <!-- page 1 content -->
</div>
<div class="sheet">
  <!-- page 2 content (each .sheet prints as its own page) -->
</div>

</body>
</html>
```

- `data-form` = the form number (unique per file) — it namespaces localStorage.
- Do NOT write any toolbar, save/load, or print JavaScript — `bir.js` injects all of it.
- Do NOT add inline `<style>` unless a form needs something truly unique (keep it tiny).

## Official header (top of first .sheet)

```html
<div class="form-head">
  <div class="fh-left">
    <div class="fh-agency">Republic of the Philippines<br>Department of Finance<br>Bureau of Internal Revenue</div>
    <div class="fh-title">Quarterly Income Tax Return</div>
    <div class="fh-sub">For Individuals, Estates and Trusts. Enter all required information in CAPITAL LETTERS using BLACK ink.</div>
  </div>
  <div class="fh-no"><span class="lbl">BIR Form No.</span><span class="num">1701Q</span><span class="ver">January 2018 (ENCS)</span></div>
</div>
```

## Layout vocabulary (from ../assets/bir.css)

- `.part-title` — inverted black bar: `<div class="part-title">Part I – Background Information</div>`
- `.sub-title` — gray sub-heading bar
- `.grid` > `.row` > `.cell` — bordered field grid. Inside a cell: `<span class="no">1</span> <span class="lbl">Label</span> <input ...>`
  - `.cell.shade` for gray non-entry cells, `.cell.stack` to stack label above input.
- `.item` rows for ITR-style numbered amount lines:
  ```html
  <div class="grid">
    <div class="item"><span class="no">36</span><span class="lbl">Sales/Revenues/Receipts/Fees</span><span class="amt"><input class="num" name="sales" type="text"></span></div>
    <div class="item total"><span class="no">38</span><span class="lbl">Gross Income</span><span class="amt"><input class="num calc" name="gross" data-calc="n('sales')-n('cos')" readonly type="text"></span></div>
  </div>
  ```
- `table.sched` for schedules/ATC tables (use `<th>` headers; input cells inside `<td>`).
- `.sig-block` > `.sig` for signature areas.
- Checkboxes/radios: `<label class="opt"><input type="checkbox" name="amended" > Yes</label>`. For mutually-exclusive marks use radios sharing one `name` with distinct `value`s.

## Field rules

- EVERY fillable control needs a unique `name` (lowercase snake_case, prefixed by part when helpful, e.g. `p2_tin`, `sched1_row1_atc`). Persistence serializes by `name`.
- Money/quantity fields: `class="num"` (right-aligned, comma-formatted on blur).
- Computed fields: `class="num calc" readonly` + `data-calc="expression"` using `n('field')` to read other fields. Implement every total, subtotal, "sum of items…", net-of, tax-due-minus-credits, and penalty-total line where the official form states the arithmetic. Chained totals are fine (engine runs 3 passes).

### Formula conventions (autocompute)

Every line the official form/guidelines derive from other lines MUST autocompute:

- `n('field')` → numeric value of a field; `v('field')` → string value of a radio/select/checkbox (for regime- or method-dependent lines); `gradTax(ti, year)` → Philippine graduated income tax (TRAIN — picks the 2018–2022 or 2023+ schedule from the year). `Math.*` is available.
- Graduated tax due lines: `data-calc="gradTax(n('net_taxable'), n('year'))"`.
- 8% flat-rate lines: `(base − 250000 allowance where the form says so) × 0.08`, floored at 0 with `Math.max(0, …)`.
- Statutory-rate lines printed on the form (12% VAT, 2% MCIT, 40% OSD, FBT gross-up ÷65% ×35%, withholding rates in schedule rate columns): put the rate in a small editable input pre-filled via `value="…"` (e.g. `value="25"`), and compute the line from it — fidelity to the printed form, but adjustable when law changes (e.g. CREATE corporate rates 25%/20%).
- Regime/method-dependent lines ("If Itemized … / If OSD …", graduated vs 8%): branch with `v('method')==='osd' ? … : …`.
- Either/or pulls ("Item 18B OR Item 25"): `n('a') || n('b')`.
- Do NOT auto-compute surcharge (25%/50%) or interest amounts — they depend on lateness; leave those user-entered, but the "Total Penalties" and "Total Amount Payable" sums over them stay computed.
- Never leave a pure-arithmetic line user-entered.
- Dates: `<input type="text" placeholder="MM/DD/YYYY">` (not type=date, to match form look).
- TIN: 4 short boxes look — acceptable simplification: one `input.mid` with placeholder `000-000-000-00000`.

## Fidelity

- Extract each form's real text with: `pdftotext -layout "<pdf path>" -` and replicate its Parts, item numbers, labels, schedules, and checkbox options faithfully (trim obvious eBIR artifacts like "CLEAR FORM").
- Keep every numbered line of the official form, in order, with its official number.
- Long ATC/alphalist schedules: reproduce the column headers and provide 5–10 input rows plus a computed total row.
- Split content into `.sheet` blocks matching the official page breaks (roughly — keep each sheet's content to what fits one printed Letter page; when in doubt start a new sheet at each Part).
- Bottom of the last relevant sheet: the standard declaration/perjury paragraph (small text) + `.sig-block`, and the "Details of Payment" grid if the official form has one.

## Print format (BIR spec)

`@page` in bir.css is FOLIO 8.5in × 13in portrait with margins T .14 / B .14 / L .146 / R .148
(RMO 24-2013 format; RMC 44-2023 / 51-2024 / 20-2026 prescribe folio-or-legal for annual ITRs too).
Screen `.sheet` mirrors this (8.5in wide, folio padding) so WYSIWYG matches print. Do not
reintroduce letter/A4 sizes or scaling. Scale (100%/Actual size) and headers/footers-off live in
the browser print dialog — bir.js shows a dismissible checklist before printing.

## Tone

No branding, no watermarks, no extra features beyond the spec. The printed output should look as close to the official BIR form as this vocabulary allows.
