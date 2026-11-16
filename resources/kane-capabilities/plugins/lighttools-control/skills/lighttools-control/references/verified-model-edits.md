# Verified model edits

Use this reference when changing scattering, grouped source layouts, or inserting optical components.

## Scalar writes and optical properties

`lt_set_verified` accepts 1–50 `{key, field, expected, i?, j?}` checks. It reads every target before writing, writes once, then compares all final values. The job fails on a mismatch; its `before` and `verification` fields retain evidence. It is not a transaction: partial changes remain, with no automatic retry or rollback. Use it for independent scalar fields on uniquely identified objects. A type change can replace child objects; perform it separately, rediscover children, then set their fields.

`lt_verify_fields` is read-only. A completed job means the reads completed; inspect `result.verified` and each comparison. Numeric tolerances use native units. These tools do not clone shared properties, resolve repeated paths, update geometry, or establish optical validity.

For scattering, verify the actual property type, propagation direction, reflectance/transmittance, distribution convention, x/y widths, rotation, Fresnel and polarization settings. A wrapper's changed-object count does not prove these values. A local elliptical-Gaussian helper call returned success but left a mixed reflecting property; the underlying cause remains unconfirmed. Discover the actual schema rather than assuming that behavior applies to every version.

Inspect users of a shared property before editing; use a distinct property when the change should apply to one surface. Enumerate `PROPERTY`, then relevant children such as `GAUSSIAN_SCATTER_AMPLITUDE_ZONE`. Repeated display paths require native list-handle reads, not path-based assertions. A reflecting mirror requires its actual reflective direction, not merely an R value under a TIR mode.

## Groups, geometry and views

Before moving a subgroup, record the parent and sibling transforms plus its source/solid children. Specify local versus global coordinates from the installed field definition. A group helper can select an ancestor; verify intended descendants moved and other branches stayed fixed. Do not repeatedly compensate with guessed transforms. Preserve a working copy before structural edits.

If geometry updates were disabled, re-enable them and complete the rebuild before inspecting global bounding boxes. Use boxes for broad collision screening, then actual surfaces and ray paths for optical clearance. Include existing diffuser substrates and nearby surfaces before inserting a lens; distinguish intentional contact from unintended overlaps.

Creating receivers can activate charts. On a view mismatch, reconnect to the same explicit PID and inspect its current model/context. Only after confirming the intended model, use a documented switch back to its 3D view. Keep the view guard; a chart title alone is not a stable model identity.

For unfamiliar list filters, inspect installed API `apirga.html` (Specific Data Access Filters). For example reference ray fans use `NS_FAN`; do not infer filters from UI labels.

## Validation after an edit

Trace a small diagnostic set through the required components before a full power run. Screen hits alone do not prove traversal through the DMD and projection pupil. Bind path-qualified power to the same source denominator and receiver domain. After changing glass, spacing or source phase space, regenerate dependent metrics rather than reusing cached acceptance.

Keep source-exit angular fill separate from DMD pupil fill. Geometric scattering describes an angular distribution; it does not establish speckle contrast or dynamic diffuser performance. Compare power and uniformity with their own sampling checks.
