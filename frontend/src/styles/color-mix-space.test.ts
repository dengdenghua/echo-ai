import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Chromium (147) treats the hue of a near-neutral colour as powerless inside
 * `color-mix(in oklch, …)` but keeps its small chroma, so the mix renders at
 * hue 0: every graphite surface mixed with white, black or transparent came
 * out pink-brown (e.g. the dark workspace header wash). oklab has no hue
 * channel, matches Tailwind's own `/alpha` mixes and keeps graphite neutral.
 */
const SRC = join(process.cwd(), "src");
const SKIP = /\.(test|spec)\.tsx?$/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(css|tsx?)$/.test(name) && !SKIP.test(name) ? [path] : [];
  });
}

describe("color-mix interpolation space", () => {
  it("never mixes in oklch", () => {
    const offenders = sources(SRC).filter((path) =>
      /color-mix\(in[ _]oklch/.test(readFileSync(path, "utf8")),
    );
    expect(offenders.map((path) => relative(SRC, path))).toEqual([]);
  });
});
