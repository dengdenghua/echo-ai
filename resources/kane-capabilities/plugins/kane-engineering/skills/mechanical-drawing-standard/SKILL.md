---
name: mechanical-drawing-standard
description: Create or audit mechanical CAD engineering drawings with GB/ISO/ASME rules for sheets, views, scales, title blocks, dimensions, tolerances, revisions and BOMs.
---

# Mechanical drawing standard

Use this skill when creating, revising, packaging or auditing mechanical engineering drawings and drawing sets. It applies to SolidWorks and other mechanical CAD systems. Do not use it for pure concept sketches, renderings, or electrical schematics.

## 1. Select the governing standard

- If the customer or project does not specify otherwise, use Chinese GB rules for Chinese-language deliverables.
- If the deliverable is for international suppliers, ask once and then lock the standard family to ISO or ASME.
- Do not mix GB, ISO and ASME conventions in one released drawing set.
- Useful reference families:
  - GB: `GB/T 14689` sheet sizes/layout, `GB/T 10609.1` title blocks, `GB/T 4458.4` dimensioning, `GB/T 1804` general tolerances, `GB/T 1182` geometrical tolerancing.
  - ISO: `ISO 128` views, `ISO 7200` title blocks, `ISO 2768-1` general tolerances, `ISO 1101` geometrical tolerancing.
  - ASME: `Y14.100` drawing practices, `Y14.3` views, `Y14.5` dimensioning and tolerancing.
- Record the selected standard, revision and language on every drawing and in the package index.

## 2. Start from a controlled template

- Use the included GB templates when the governing standard is GB:
  - `templates/GB-A0.DRWDOT`, `templates/GB-A3.DRWDOT`, `templates/GB-A4纵.DRWDOT`
  - matching `.slddrt` sheet formats are stored beside them.
- For ISO/ASME work, use the customer template or create a dedicated template; do not improvise a new title block per sheet.
- Confirm units, projection convention, decimal precision, line styles, fonts, border, zone grid and title block links before adding views.

## 3. Sheet and view rules

- Prefer A3 for single mechanical parts unless geometry or readability requires A0/A1/A2/A4.
- Every part drawing needs at least one global orthographic view set that shows the whole part, orientation and datum.
- Put global views before local details. Never use only local views or assembly screenshots as the manufacturing drawing.
- Keep one main drawing scale on a sheet. Detail views may use another scale only when clearly labelled, e.g. `DETAIL A 5:1`.
- Do not place the same part's orthographic views at different unlabeled scales.
- Use model-associated views and dimensions. Static screenshots, paragraph text dimensions and table-only coordinates are not release drawings.
- Use section, detail and auxiliary views when hidden geometry, slopes, holes, slots or internal passages cannot be read from the global views.
- Keep first/third angle projection consistent; do not mix projection symbols or omit the convention when required by the governing standard.

## 4. Dimension and tolerance rules

- Dimension from stable datums and functional interfaces, not from arbitrary screen edges.
- Fully define size, position, thickness, holes, threads, fits, chamfers, radii and key interfaces.
- Avoid duplicate, closed and contradictory dimension chains.
- Use tolerance values appropriate to function; do not treat decimal places as tolerance.
- Add general tolerance class only when a real standard is selected, e.g. GB/T 1804 or ISO 2768-1.
- Add GD&T only where form, orientation, position or runout affect function, assembly or sealing.
- Surface roughness, coating, weld, bend, mould draft, shrinkage, assembly torque and test requirements belong on the drawing or a referenced controlled note.

## 5. Title block, revision and BOM

- Every drawing must identify:
  - part/assembly number and name,
  - material and condition,
  - scale, units, projection convention,
  - sheet size and sheet `n/m`,
  - revision and date,
  - designer/checker/approver as required,
  - drawing standard and tolerance class,
  - mass or volume where relevant.
- Revision tables must state what changed, where and why. Do not reuse an old sheet with only a new filename.
- Assembly drawings need a BOM with item number, part number, name, material/source, quantity and note. Purchased parts are marked as purchased/reference, not self-made.
- Keep PDF, DWG/DXF, STEP and BOM at the same revision. Remove obsolete versions from the delivery package.

## 6. Minimum audit checklist

Before release or delivery, verify:

- one governing standard and language;
- one main scale per sheet and labelled detail scales;
- global view exists before local detail;
- no missing orthographic/section/detail views needed for manufacture;
- dimensions and tolerances are geometrically associated and readable;
- title block, revision table and material/process notes complete;
- BOM, drawing, model and STEP revision agree;
- obsolete drawings are removed from the package;
- PDF/DWG/DXF/STEP exports open and are not empty;
- page count and file inventory match the drawing index.

## 7. Evidence

- Save the audit as JSON/Markdown/CSV with page-by-page results and issue severity.
- Render PDF pages to images and visually inspect layout, clipped text and missing views.
- Record pass, fail, `N/A` and unverified separately. Geometry completion is not manufacturing approval.
- Keep the source model, generated drawing, exports and evidence in separate locations.
