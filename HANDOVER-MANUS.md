# BIR Tax App — Handover for Manus integration

Self-contained fillable replicas of 30 Philippine BIR tax returns with auto-computation,
saved records, a filing workflow (Draft → FILED → Amended), and folio-format PDF export.
Everything is static HTML/CSS/JS — no build step, no server-side code, no external
dependencies or CDNs. Serve the folder as-is and it runs.

## 1. What's in the package

```
Tax App/
├── index.html            Dashboard — lists all 30 forms by tax type
├── HANDOVER-MANUS.md     This file
├── assets/
│   ├── bir.css           All styling: BIR form look, toolbar, print (@page folio)
│   ├── bir.js            The engine: records, autosave, calc, filing workflow,
│   │                     print/PDF filename, window.BIRForm integration API
│   └── FORM-SPEC.md      Conventions for building/editing form pages
└── forms/
    ├── 0605.html … 2551Q.html   (30 files, one per BIR form)
```

Each form page is a plain HTML file that links `../assets/bir.css` and `../assets/bir.js`.
**Keep the relative layout** (`forms/*.html` next to `assets/`) or update the two paths in
each form's `<head>`.

## 2. Embedding in Manus

- Host the folder statically and route to `forms/<FORM>.html` (iframe or full page both work).
- The engine needs no init call — on DOMContentLoaded it injects the toolbar, loads the
  active record from localStorage, and wires autosave/recalc.
- `<body data-form="2551Q">` namespaces the storage. If you mount two copies of the same
  form for different tenants, give each a distinct `data-form` (e.g. `2551Q-clientA`).
- The "← Tax App" toolbar link points to `../index.html`; change or remove if you have
  your own navigation.

## 3. Data model & persistence

One localStorage key per form: `birtax:<FORM_ID>` containing:

```json
{
  "current": "Record 1",
  "records": {
    "Record 1": {
      "data":        { "<field name>": "<string value>", "<checkbox>": true },
      "status":      "draft" | "filed" | "amended",
      "filedAt":     "2026-08-27T08:57:33.706Z" | null,
      "amendedFrom": "Record 1" | null
    }
  }
}
```

- Every fillable control has a unique `name` (radio groups share one name; the stored value
  is the checked radio's `value`).
- Computed fields are also stored (they are re-derived on load anyway).
- localStorage is per browser + origin. To persist centrally in Manus, read/write through
  `window.BIRForm` (below) and store the JSON on your backend, or mirror the key.

## 4. Integration API — `window.BIRForm`

Available on every form page (this is how you "sync the numbers to the form later"):

```js
BIRForm.formId                 // "2551Q"
BIRForm.getData()              // {field: value} of everything on the form
BIRForm.setData({...})         // merge values in, recalc, autosave.
                               // THROWS if the record is filed/locked
                               // (pass {force:true} as 2nd arg to override).
BIRForm.setField(name, value)  // single-field variant
BIRForm.recalc()               // re-run all computations manually

BIRForm.getRecord()            // {name, status, filedAt, amendedFrom, locked}
BIRForm.listRecords()          // all saved records with statuses
BIRForm.selectRecord(name)     // switch active record
BIRForm.createRecord(name, data?) // new draft record (optionally pre-filled)

BIRForm.file()                 // mark active record FILED (or AMENDED if it is
                               // an amendment) — no dialog; throws if already filed
BIRForm.unfile()               // revert to Draft (host confirms "not actually filed")
BIRForm.createAmendment()      // duplicate the filed record as an unlocked
                               // amendment draft; returns its name

BIRForm.suggestedFilename()    // "2026-08-August-2551Q-MSL CPAs & Co - 00.00"
BIRForm.print()                // print/Save-as-PDF with that filename applied
```

To set values, always use `setData`/`setField` (they dispatch recalc + autosave). If you
poke input values directly, dispatch `input` events or call `BIRForm.recalc()` after.

## 5. Calculation engine

- Any input with `data-calc="expression"` is computed (3 passes per change, so chained
  totals settle). Computed inputs are `readonly` with class `num calc`.
- Expression helpers (all global): `n('field')` → number (comma-safe, `(x)` = negative),
  `v('field')` → string value of radio/select/checkbox, `gradTax(taxable, year)` →
  Philippine graduated income tax (TRAIN; auto-selects the 2018–2022 or 2023+ schedule),
  plus anything on `Math`.
- Statutory rates (12% VAT, 25% RCIT, 2% MCIT, 40% OSD, 8% flat, FBT 65/35…) are small
  **editable inputs pre-filled** with the current rate, so formulas survive law changes.
- Surcharge/interest/compromise amounts are deliberately manual (lateness-dependent);
  every total over them is computed.
- Fields with class `num` right-align and comma-format on blur.

## 6. Filing workflow (in the toolbar)

- **💾 Save** — explicit save (autosave also runs 600 ms after each change).
- **Save and File** — confirmation dialog ("all details final, form will be locked"),
  then status → **FILED** (green badge, timestamp). All fields become disabled, a
  "FILED — LOCKED FOR CHANGES" ribbon shows on screen (never on the printout).
- Clicking any field of a filed form opens the locked dialog with three choices:
  **Close**, **Not filed yet — unlock** (second confirmation, reverts to Draft), or
  **Create amended return** (copies the record as "<name> (Amended)", unlocked draft,
  reminds the user to tick "Amended Return? = YES" on the form).
- **Save and File** on an amendment marks it **AMENDED** (orange badge) and the PDF
  filename gains an ` - Amended` suffix.
- Statuses appear in the record dropdown (`✓ FILED` / `✓ AMENDED`) and via
  `BIRForm.listRecords()`.

## 7. Print / Export as PDF

- `@page` is **Folio 8.5in × 13in portrait**, margins T .14 / B .14 / L .146 / R .148
  (RMO 24-2013 format; RMC 44-2023 / 51-2024 / 20-2026). Do not reintroduce Letter/A4.
- Each `.sheet` div prints as one page (`page-break-before: always` between sheets).
- "Export as PDF" shows a one-time checklist (paper folio/legal, scale 100%, headers off)
  with an editable filename, then calls `window.print()`. The filename is applied via
  `document.title`, which Save-as-PDF dialogs use as the default name.
- Filename convention: `YYYY-MM-Month-Form-Client - AmountDue` (e.g.
  `2026-08-August-2551Q-MSL CPAs & Co - 00.00`). Sources per form live in the
  `FILE_META` map at the top of the filename section in `bir.js` — month/quarter/year
  fields, client-name field, and total-amount-due field for each of the 30 forms.
  Quarterly forms use the last month of the selected quarter.

## 8. Adding or editing forms

Follow `assets/FORM-SPEC.md` (skeleton, CSS vocabulary, naming, calc conventions,
print format). Checklist for a new form: unique `data-form`, unique snake_case `name`
on every control, `data-calc` + `readonly` on every derivable line, add an entry to
`FILE_META` in bir.js for the PDF filename, and link it from index.html.

## 9. Gotchas

- **Stylesheet caching:** after updating `assets/bir.css`/`bir.js`, hard-refresh
  (⌘⇧R) or version the asset URLs — browsers cache them aggressively.
- **`>` inside `data-calc`** (e.g. `n('x')>0 ? …`) is valid, but naive regex parsing of
  the HTML breaks on it; parse attributes quote-aware if you post-process files.
- localStorage can be cleared by the browser; treat the backend (via BIRForm) as the
  source of truth in Manus.
- The engine intentionally has no external network calls; everything works offline.
