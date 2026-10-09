# Creating a new Flow project with the installed wizard

This workflow uses the local Flow callback plus observed Windows UI. It is not a headless project-creation API. Use the computer-use skill for UI steps and always re-observe after navigation; do not replay coordinates from an earlier session.

1. Prepare a dedicated saved native part/assembly working copy and identify its exact path. Check Flow diagnostics without reloading an already accessible API.
2. Call `sw_flow_new_project_wizard(document)`. Its result only means the callback was invoked. Inspect the wizard; do not call it again if it is already open.
3. Set the project name/configuration and units. Select internal/external analysis and the required physics. Enabling heat conduction exposes solid-material settings. Use actual project requirements for gravity, radiation and transient options.
4. Add the fluid explicitly from the database and verify it appears in the project-fluid list. Merely selecting the library row does not add it.
5. Choose the default solid material, wall properties, pressure, temperature and velocity. Confirm the edited value after leaving each cell.
6. Finish, inspect `sw_flow_project`, and save the working file through the observed UI. Export `sw_flow_snapshot`; verify named settings and material UUID against the raw XML material names. Saving may create a numbered Flow folder beside the native document.
7. Close only if clean, reopen, and verify the same project exists. A dirty flag after reopen can be caused by Flow loading; do not silently discard it.
8. Add required sources, goals and boundary details before solving. Project creation alone is not thermal/flow validation.

## Verified fixture (2026-09-08)

`D:\AI\SolidWorksMCP\validation\new-flow-project\flow-new-cylinder.SLDPRT`

Created from a cylinder with no Flow project, not cloned from an existing simulation. Project name: `External air conduction test`. External analysis, SI units, air, solid conduction enabled, aluminum default solid, roughness 0, pressure 101325 Pa, temperature 293.2 K, X velocity 1 m/s, Y/Z velocity 0, automatic mesh level 3. These are test inputs, not defaults for the user's machine.

Creation readback: f9c0f41a0dca4ca79763ee43c9799faf. Saved settings: de700a9cd51f43248f4f5d570cebb90a. Aluminum UUID: 6D4EB360944911D4B47100A024552746. Settings XML SHA256: a9b380f1f0f478f8b1f63d50f4fa2229e7e2fd2c29178ff0765ccd7ac8926e5a.

Clean close cb4a53fa24124df3b84a5864b9fc3085 and reopen 1254b389da1a4702b2bf9b544bef25ab succeeded. Project readback c22f24c5fb994861bff90d916cf9c986 confirms persistence. No heat source, goals or solve were created in this fixture yet.
