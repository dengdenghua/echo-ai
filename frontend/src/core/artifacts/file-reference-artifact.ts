/**
 * Map a file reference cited in an answer (`hello.py`, `output/final/a.md`,
 * an absolute workspace path) onto the conversation's artifact list, so the
 * chip opens the produced file instead of guessing a path under the
 * workspace root.
 */
import { getFileName } from "@/core/utils/files";

import { parseWorkspaceOutputRef } from "./utils";

function normalizePath(path: string) {
  return path
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^(?:\.\/)+/, "");
}

/**
 * The spellings an answer may use for one artifact: its path inside the
 * output area (`hello.py`) and the area-qualified workspace path the agent
 * wrote it to (`output/final/hello.py`).
 */
function artifactSpellings(artifact: string) {
  const output = parseWorkspaceOutputRef(artifact);
  if (!output) {
    const legacy = normalizePath(artifact).replace(/^\/+/, "");
    const inOutputs = /(?:^|\/)outputs\/(.+)$/.exec(legacy)?.[1];
    return { relative: inOutputs ?? legacy, qualified: legacy };
  }
  const relative = normalizePath(output.relativePath);
  const qualified =
    output.area === "final" || output.area === "stages"
      ? `output/${output.area}/${relative}`
      : `${output.area}/${relative}`;
  return { relative, qualified };
}

/** Artifacts whose file name is `name` (listing order: deliverables first). */
export function artifactsNamed(name: string, artifacts: readonly string[]) {
  const wanted = getFileName(normalizePath(name));
  if (!wanted) return [];
  return artifacts.filter(
    (artifact) => getFileName(artifactSpellings(artifact).relative) === wanted,
  );
}

/**
 * The artifact a file reference points at, or null when the reference is a
 * workspace file. A path with directories must match the artifact's own
 * path; a bare file name also matches when exactly one artifact has it.
 */
export function findArtifactForFileReference(
  reference: string,
  artifacts: readonly string[],
): string | null {
  if (artifacts.length === 0) return null;
  if (artifacts.includes(reference)) return reference;
  const path = normalizePath(reference);
  if (!path) return null;
  const bare = !path.includes("/");
  const exact = artifacts.find((artifact) => {
    const { relative, qualified } = artifactSpellings(artifact);
    if (path === relative || path === qualified) return true;
    return (
      !bare &&
      (`/${qualified}`.endsWith(`/${path}`) || path.endsWith(`/${qualified}`))
    );
  });
  if (exact) return exact;
  if (!bare) return null;
  const named = artifactsNamed(path, artifacts);
  return named.length === 1 ? named[0]! : null;
}
