---
name: blender-control
description: Control this Windows machine's Blender session through the local Blender MCP for scene inspection, object placement, mechanical assembly visualization, PCB replacement, screenshots, rendering, and exports. Use when work must read or modify a live .blend scene.
---

# Blender 本地控制

Use the plugin's `blender_official` MCP tools to inspect and operate the live Blender scene. The connection requires the Blender MCP add-on to be enabled and listening on `127.0.0.1:9876`.

Before editing, read the blend-file path, scene objects, linked libraries, and missing files. Save to a new `.blend` path when the source is an imported or reference assembly, unless the user explicitly selected the current file as the working copy.

Use the summary and object-detail tools for reads. Use `execute_blender_code` only when an existing focused tool cannot perform the change. Keep scripts bounded to the requested scene operation and return concise evidence: affected object names, transforms, output paths, or counts.

For object replacement in mechanical assemblies:

1. Identify the old object and the replacement by exact names and verify their dimensions, origin, parent, collection, and world transform.
2. Preserve the old object's world transform and collection placement. Keep the old object hidden as a recoverable backup when practical; do not delete it merely to reduce clutter.
3. Align using known CAD datums or connector geometry. A matching bounding box alone does not establish connector orientation or mounting-hole alignment.
4. Check visibility, scale, orientation, and obvious interference from multiple views. Save the working copy and generate a viewport or rendered preview for review.

For PCB and connector work, distinguish appearance models from manufacturing CAD. Photographs can guide visible placement and orientation, but cannot prove hidden pin geometry, exact board dimensions, or electrical connectivity. Record assumptions in object names or a nearby text object only when useful to the project.

Prefer STEP or native CAD for dimension-critical exchange with SolidWorks. Use GLB/GLTF for visual materials and Blender exchange, and STL only for mesh or printing needs. Verify the created file exists and reopen or inspect it when the export is a deliverable.

Do not run unrelated Python, install packages from scene scripts, or write outside the requested project and explicit output paths. Avoid global destructive cleanup commands. When many objects are changed, save a new checkpoint before the mutation.

## Echo integration

In Echo, discover the registered tools with `search_capabilities` before use. The MCP tool names carry the `mcp_blender_official_` prefix; all arguments and operating rules above still apply. Read this skill and its references before changing a document.
