import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * BRAND.md: Chinese (and Japanese/Korean) text is never letter-spaced; only
 * Latin uppercase eyebrows and telemetry are tracked. Tracking utilities are
 * neutralised by one rule in globals.css; hand-written stylesheets may track
 * only selectors whose text is always Latin.
 */
const SRC = join(process.cwd(), "src");
const globals = readFileSync(join(SRC, "styles/globals.css"), "utf8");

/** Stylesheet rules allowed to track: their text never comes from a locale. */
const LATIN_ONLY = new Set([
  "app/login/login.css :: .echo-login-brand-product",
  "app/login/login.css :: .echo-login-eyebrow, .echo-login-card-kicker",
  "app/login/login.css :: .echo-login-title",
  "app/login/login.css :: .echo-login-title strong",
  "app/login/login.css :: .echo-login-lead span",
  "app/login/login.css :: .echo-login-continuum strong",
  "app/login/login.css :: .echo-login-footer",
]);

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

function trackedSelectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  for (const match of text.matchAll(/letter-spacing:\s*([^;}]+)/g)) {
    if (/^(normal|0(px|em)?)\s*$/.test(match[1] ?? "")) continue;
    const open = text.lastIndexOf("{", match.index);
    const start =
      Math.max(
        text.lastIndexOf("}", open - 1),
        text.lastIndexOf("{", open - 1),
        text.lastIndexOf(";", open - 1),
      ) + 1;
    found.push(text.slice(start, open).replace(/\s+/g, " ").trim());
  }
  return found;
}

describe("CJK letter-spacing", () => {
  it("resets every tracking tier for Chinese, Japanese and Korean", () => {
    const rule = globals.match(
      /:is\(:lang\(zh\), :lang\(ja\), :lang\(ko\)\):is\(([\s\S]*?)\)\s*\{\s*letter-spacing:\s*normal;/,
    );
    expect(rule).not.toBeNull();
    const tiers = rule?.[1] ?? "";
    for (const tier of [
      ".tracking-eyebrow",
      ".tracking-caps",
      ".tracking-tighter",
      ".tracking-tight",
      ".tracking-wide",
      ".tracking-wider",
      ".tracking-widest",
      '[class*="tracking-["]',
      "[cmdk-group-heading]",
    ]) {
      expect(tiers).toContain(tier);
    }
    // Mono eyebrows carry locale text too; Latin-only ones opt out with lang="en".
    expect(tiers).not.toContain("font-mono");
  });

  it("tracks hand-written stylesheet rules only where the text is Latin", () => {
    const offenders = stylesheets(SRC).flatMap((path) => {
      const file = relative(SRC, path).replace(/\\/g, "/");
      return trackedSelectors(readFileSync(path, "utf8"))
        .map((selector) => `${file} :: ${selector}`)
        .filter((entry) => !LATIN_ONLY.has(entry));
    });
    expect(offenders).toEqual([]);
  });
});
