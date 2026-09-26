import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Accessibility + theme-layering gates.
 *
 * Why this exists: three real defects shipped to production because nothing
 * machine-checked them —
 *   1. Landing footer text at 3.49:1 (below WCAG AA 4.5:1).
 *   2. Feature captions rendered at 8px.
 *   3. An unlayered `html, body { background: … }` rule in index.html silently
 *      overrode `@layer base`, pinning html/body to white even in dark mode.
 *
 * The hard assertions below lock the fixes. The ratchets (`BASELINE_*`) cover
 * debt that is too large to clear in one pass: the only legal direction is
 * down, so any new violation turns CI red.
 */
const root = process.cwd();
const globalsCss = readFileSync(join(root, "src/styles/globals.css"), "utf8");
const loginCss = readFileSync(join(root, "src/app/login/login.css"), "utf8");
const indexHtml = readFileSync(join(root, "index.html"), "utf8");

type Rgb = [number, number, number];

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgb): number {
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function parseHex(value: string): Rgb {
  const hex = value.trim().replace(/^#/, "");
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

/** Extract every declaration block that follows a top-level selector. */
function blocksAfter(source: string, selector: string): string[] {
  const blocks: string[] = [];
  let at = source.indexOf(selector);
  while (at >= 0) {
    const start = source.indexOf("{", at);
    if (start < 0) break;
    let depth = 0;
    let end = -1;
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break;
    blocks.push(source.slice(start + 1, end));
    at = source.indexOf(selector, end);
  }
  return blocks;
}

function blockAfter(source: string, selector: string): string {
  return blocksAfter(source, selector)[0] ?? "";
}

function token(block: string, name: string): string | null {
  const match = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
}

// Any custom property that is itself a var() indirection cannot be resolved
// statically; callers assert on the tokens that are literal colors.
function literalColor(block: string, name: string): Rgb | null {
  const raw = token(block, name);
  if (!raw) return null;
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? parseHex(raw) : null;
}

const lightBlock = blockAfter(globalsCss, "\n:root {");
const darkBlock = blockAfter(globalsCss, "\n.dark {");
const steelBlock = blockAfter(globalsCss, '[data-theme="steel"]');

// The landing shell always renders on the dark brand surfaces, so every text
// color in login.css is measured against the darkest and lightest of them.
const SHELL_BG: Rgb = [2, 3, 8];
const CARD_BG: Rgb = [10, 14, 27];

describe("theme token contrast (WCAG AA)", () => {
  it("resolves the light, dark, and steel token blocks", () => {
    expect(lightBlock.length).toBeGreaterThan(0);
    expect(darkBlock.length).toBeGreaterThan(0);
    expect(steelBlock.length).toBeGreaterThan(0);
  });

  const pairs: Array<[string, string, string, number]> = [
    ["--foreground", "--background", "body text", 4.5],
    ["--muted-foreground", "--background", "muted text", 4.5],
    ["--muted-foreground", "--card", "muted text on card", 4.5],
    ["--card-foreground", "--card", "card text", 4.5],
    ["--primary-foreground", "--primary", "primary button label", 4.5],
    ["--sidebar-foreground", "--sidebar", "sidebar text", 4.5],
  ];

  for (const [fg, bg, label, min] of pairs) {
    it(`light theme: ${label} >= ${min}:1`, () => {
      const a = literalColor(lightBlock, fg);
      const b = literalColor(lightBlock, bg);
      expect(a, `${fg} must be a literal hex color`).not.toBeNull();
      expect(b, `${bg} must be a literal hex color`).not.toBeNull();
      expect(contrast(a!, b!)).toBeGreaterThanOrEqual(min);
    });

    it(`dark theme: ${label} >= ${min}:1`, () => {
      const a = literalColor(darkBlock, fg);
      const b = literalColor(darkBlock, bg);
      expect(a, `${fg} must be a literal hex color`).not.toBeNull();
      expect(b, `${bg} must be a literal hex color`).not.toBeNull();
      expect(contrast(a!, b!)).toBeGreaterThanOrEqual(min);
    });

    it(`steel theme: ${label} >= ${min}:1`, () => {
      const a = literalColor(steelBlock, fg);
      const b = literalColor(steelBlock, bg);
      if (a && b) {
        expect(contrast(a, b)).toBeGreaterThanOrEqual(min);
      }
    });
  }
});

describe("landing page text contrast", () => {
  it("never paints a hex text color below AA on the brand surfaces", () => {
    const offenders: string[] = [];
    const re = /color:\s*(#[0-9a-fA-F]{6})\s*;/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(loginCss)) !== null) {
      const color = parseHex(match[1]);
      const worst = Math.min(
        contrast(color, SHELL_BG),
        contrast(color, CARD_BG),
      );
      if (worst < 4.5) {
        offenders.push(`${match[1]} (${worst.toFixed(2)}:1)`);
      }
    }
    expect(
      offenders,
      `sub-AA text colors on the landing page: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the four feature captions at a readable size", () => {
    // The selector is declared twice (a shared `display: block` rule and the
    // caption styling), so inspect every block that sets a font-size.
    const sizes = blocksAfter(loginCss, ".echo-login-continuum small {")
      .map((block) => token(block, "font-size"))
      .filter((value): value is string => Boolean(value))
      .map((value) => Number.parseFloat(value));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(size).toBeGreaterThanOrEqual(12);
    }
  });
});

describe("theme layering", () => {
  it("scopes the startup background so it cannot outrank the app theme", () => {
    // An unlayered `html, body { background: … }` beats @layer base and
    // pinned dark mode to white, so the splash may only paint before the
    // theme provider puts .light/.dark on <html>. Any rule that paints the
    // startup background on a *bare* html/body selector is a regression.
    const rules = indexHtml.matchAll(/([^{}]+)\{([^{}]*)\}/g);
    const offenders: string[] = [];
    for (const [, selector, body] of rules) {
      if (!body.includes("--startup-background")) continue;
      // Comments must be stripped first: a leading `/* … */ html,` would
      // otherwise never compare equal to the bare `html` we are hunting.
      const bare = selector
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part === "html" || part === "body");
      if (bare.length > 0) {
        offenders.push(selector.trim().replace(/\s+/g, " "));
      }
    }
    expect(
      offenders,
      `startup background painted on an unscoped shell selector: ${offenders.join(" | ")}`,
    ).toEqual([]);
  });

  it("defines the theme background token in both schemes", () => {
    expect(literalColor(lightBlock, "--background")).not.toBeNull();
    expect(literalColor(darkBlock, "--background")).not.toBeNull();
  });
});

describe("contrast debt ratchet", () => {
  // `text-muted-foreground/<80>` composites below 4.5:1 in dark mode
  // (e.g. /60 measures ~3.3:1, /40 ~1.5:1). All 381 historical debt occurrences
  // across src/ have been cleared to standard tokens. The baseline is locked at 0.
  const BASELINE_MUTED_OPACITY_BELOW_80 = 0;

  it("never adds another sub-AA muted-foreground opacity modifier", () => {
    const srcDir = join(root, "src");
    const re = /text-muted-foreground\/(?:[0-7]\d|\d)\b/g;
    let total = 0;
    function scanDir(dir: string) {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(full);
        } else if (/\.(tsx?|css)$/.test(entry.name)) {
          const content = readFileSync(full, "utf8");
          total += (content.match(re) ?? []).length;
        }
      }
    }
    scanDir(srcDir);
    expect(total).toBeLessThanOrEqual(BASELINE_MUTED_OPACITY_BELOW_80);
  });
});
