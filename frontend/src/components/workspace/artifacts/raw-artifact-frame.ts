import { getFileExtension } from "@/core/utils/files";

/**
 * `sandbox` attribute for the raw (non-code, non-office) artifact iframe.
 *
 * Artifacts are user/agent-written and served from the API origin, so an
 * SVG/XHTML/XML file with `<script>` must never run as the app. An empty
 * sandbox gives the frame an opaque origin with scripts disabled; images,
 * audio and video still render.
 *
 * PDF is the one exception: browsers refuse to start their PDF viewer inside
 * a sandboxed frame, and that viewer never runs with the serving origin.
 * Returning `undefined` omits the attribute entirely.
 */
export function rawArtifactFrameSandbox(filepath: string): string | undefined {
  return getFileExtension(filepath) === "pdf" ? undefined : "";
}
