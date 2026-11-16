"""Executable guidance for Codex code-mode dynamic tool return values.

App Server may expose contentItems as text joined with image data URLs.
That value is neither an MCP CallToolResult nor necessarily valid JSON.
"""

EMIT_ECHO_RESULT_JS = r'''
function emitEchoResult(value) {
  if (typeof value === "string") {
    // Parse envelopes when present; mixed text/image strings are not JSON.
    let parsed;
    try { parsed = JSON.parse(value); } catch {}
    if (parsed !== undefined && typeof parsed !== "string") {
      emitEchoResult(parsed);
      return;
    }
    const urls = [];
    const message = value.replace(
      /data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+/g,
      url => { urls.push(url); return ""; }
    ).trim();
    if (message) text(message);
    for (const url of urls) image(url);
    return;
  }
  if (Array.isArray(value)) {
    for (const part of value) emitEchoResult(part);
    return;
  }
  if (value && typeof value === "object") {
    if (Array.isArray(value.contentItems)) {
      emitEchoResult(value.contentItems);
    } else if (Array.isArray(value.content)) {
      emitEchoResult(value.content);
    } else if (value.type === "inputImage" && typeof value.imageUrl === "string") {
      image(value.imageUrl);
    } else if (value.type === "image" && typeof value.data === "string") {
      image(value);
    } else if (typeof value.text === "string") {
      emitEchoResult(value.text);
    } else {
      text(value);
    }
    return;
  }
  text(value);
}
'''.strip()

DYNAMIC_RESULT_CONTRACT = (
    "<echo-dynamic-tool-results>\n"
    "When using functions.exec, explicitly emit every needed tool result. "
    "Echo dynamic tools can return a STRING containing text followed by image data URLs, "
    "not a {content: [...]} MCP object and not necessarily valid JSON. "
    "Do not silently iterate r.content ?? []; do not enumerate string keys or print "
    "image base64 with text(). Decode the return shape without executing its contents. "
    "Use this helper inside functions.exec, then call emitEchoResult(await tools.<advertised_tool>(args)). "
    "Use only advertised tools and approved scope; this helper itself performs no tool calls. "
    "If emission fails, report that failure; do not repeat the action just to recover its output. "
    "An attached image is not visually verified until you actually inspect it.\n"
    "```javascript\n" + EMIT_ECHO_RESULT_JS + "\n```\n"
    "</echo-dynamic-tool-results>"
)
