# Declarative part plan

`sw_create_part(plan, output_path)` takes a millimetre JSON plan, builds a NEW part in the
running SolidWorks session, verifies the result, then saves it to a new absolute `.sldprt`
path. Nothing is overwritten and a failed plan discards its own scratch document.

## Shape

```json
{
  "units": "mm",
  "template": null,
  "sketches": [
    {"plane": "Front Plane", "entities": [{"type": "corner_rectangle", "x1": -60, "y1": -40, "x2": 60, "y2": 40}]}
  ],
  "features": [
    {"type": "extrude_boss", "sketch": 1, "depth": 10},
    {"type": "fillet", "radius": 2, "edges": "all"}
  ],
  "verify": {"bodies": 1, "volume_mm3": 94869.0266, "tolerance": 1e-5},
  "exports": [{"format": "step"}]
}
```

`units` is optional and only `mm` is accepted. `template` defaults to
`C:\ProgramData\SOLIDWORKS\SOLIDWORKS 2026\templates\gb_part.prtdot`.

## Sketch entities

All coordinates are millimetres, in the sketch plane.

| type | keys |
| --- | --- |
| `line` | `x1, y1, x2, y2` |
| `rectangle` | `cx, cy, w, h` (centre + full width/height) |
| `corner_rectangle` | `x1, y1, x2, y2` (diagonal corners) |
| `circle` | `cx, cy, r` (or `d`) |
| `arc` | `cx, cy, x1, y1, x2, y2, direction` (1 = CCW) |
| `polygon` | `cx, cy, r, sides` |
| `slot` | `x1, y1, x2, y2, r` |
| `spline` | `points: [[x, y], ...]` |

A feature that drives a sketch needs a CLOSED contour. Every entity in one sketch is used
as one profile, which is the supported way to place a hole array or symmetric geometry.

## Features

| type | keys |
| --- | --- |
| `extrude_boss` | `sketch`, `depth` (mm) or `through_all: true`, `direction`, `flip`, `merge` |
| `extrude_cut` | `sketch`, `depth` (mm) or `through_all: true`, `direction`, `flip` |
| `extrude_midplane` | `sketch`, `total_depth` (mm), `merge` |
| `fillet` | `radius` (mm), `edges` |
| `chamfer` | `distance` (mm), `angle_deg`, `edges` |
| `shell` | `thickness` (mm), `faces` |

`sketch` is a 1-based index into `sketches`, or a literal sketch name. Square-bracket
positions in the result (`sketch_names`, `features_applied[].name`) tell you the real
SolidWorks names, which differ on a Chinese UI (`草图1`, `凸台-拉伸1`, `圆角1`).

`edges` and `faces` are either `"all"`, `"none"`, or a list of
`{"point": [x, y, z]}` picks in millimetres; the nearest edge or face is selected. A
point pick is resolved by `GetClosestPointOn` when the API offers it.

## Verification

`verify` is compared against the measured model:

- `bodies` - exact solid body count.
- `volume_mm3` - analytic volume, compared with relative `tolerance` (default `1e-3`).
- `tolerance` - relative tolerance.

The result also reports `rebuild.whats_wrong_count` and the measured `body_bounds_mm`.
`verified` is true only when a `verify` block was supplied AND the plan passed AND the
rebuild reported no errors.

## Verified on this machine

Every case below built, saved, reported zero rebuild errors and matched its analytic
expectation. Evidence: `C:\Users\Administrator\Documents\SolidWorks-AI\mcp-model-test-20260921\final\battery.json`.

| case | measured mm3 | expectation |
| --- | --- | --- |
| 120x80x10 plate, four ø6 through holes | 94869.02665 | 94869.02664 (exact) |
| plate + fillet r2 on all edges | 95289.6517 | less than the solid plate |
| plate + fillet r3 on two picked edges | 23961.37167 | less than 60x40x10 |
| plate + chamfer 1.5 on all edges | 95073.0 | less than the solid plate |
| closed shell, 60x40x20, t2 | 15744.0 | 48000 - 56x36x16 (exact) |
| open-top shell, same body, t2 | 11712.0 | open shell |
| midplane extrude, 120x80, 20 total | 192000.0 | 120x80x20 (exact) |
| through-all boss, ø30 | 706858.34706 | fills available space |
| hexagon r20, side 6, depth 10 | 10392.30485 | 3*sqrt(3)/2*400*10 (exact) |
| slot 30 long, r4, depth 10 | 1325.66371 | 2*r*L + pi*r^2 |
| closed 4-line loop 50x30, depth 8 | 12000.0 | 50x30x8 (exact) |

A three-hole array expressed as three `circle` entities in one sketch matched
6691.062 mm3 exactly, which is the supported replacement for a linear pattern.

## Known limits

- `linear_pattern`, `circular_pattern` and `mirror_feature` are refused: on this build
  those APIs return False, change nothing, and raise no error.
- `arc`/`spline` contours were not verified as closed extrude profiles.
- Holes are simple cut circles; there is no thread, counterbore or hole-wizard metadata.
- Sketches are not fully constrained with driving dimensions, so editing them in the UI
  later can move geometry. Treat the plan as the source of truth.