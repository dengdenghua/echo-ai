import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

describe("global appearance chrome rules", () => {
  it("keeps structural sidebar chrome hard-edged", () => {
    expect(css).toContain('[data-slot="sidebar-container"]');
    expect(css).toContain('[data-slot="sidebar-inner"]');
    expect(css).toContain('[data-slot="sidebar-inset"]');
    expect(css).toMatch(
      /\[data-slot="sidebar-container"\][\s\S]*?\[data-slot="sidebar-inner"\][\s\S]*?\[data-slot="sidebar-inset"\][\s\S]*?border-radius:\s*0\s*!important;/,
    );
  });

  it("keeps card and dialog radius controlled by the appearance scale", () => {
    expect(css).toMatch(
      /\[data-slot="card"\][\s\S]*?\[data-slot="dialog-content"\][\s\S]*?border-radius:\s*var\(--appearance-radius-2xl\)\s*!important;/,
    );
  });

  it("never applies implicit all-property transitions to shared controls", () => {
    expect(css).toMatch(
      /\[data-slot="switch"\][\s\S]*?transition-property:\s*[\s\S]*?color,[\s\S]*?background-color,[\s\S]*?box-shadow,[\s\S]*?transform\s*!important;/,
    );
    expect(css).toMatch(
      /\.message-list-scroll-viewport\s*\{[\s\S]*?scrollbar-gutter:\s*stable;[\s\S]*?transition:\s*none;/,
    );
    expect(css).toMatch(
      /\.stable-scroll-viewport\s*\{[\s\S]*?scrollbar-gutter:\s*stable;[\s\S]*?transition:\s*none;/,
    );
  });

  it("draws one lucide chevron for every disclosure instead of the native marker", () => {
    expect(css).toMatch(/summary\s*\{\s*list-style:\s*none;\s*\}/);
    expect(css).toMatch(
      /summary::-webkit-details-marker\s*\{\s*display:\s*none;\s*\}/,
    );
    const chevron = css.match(
      /summary:not\(\.list-none\)::before\s*\{([\s\S]*?)\}/,
    );
    expect(chevron).not.toBeNull();
    const body = chevron?.[1] ?? "";
    expect(body).toContain("background-color: currentColor;");
    // lucide chevron-right, masked so it takes the summary's colour.
    expect(body).toContain("d='m9 18 6-6-6-6'");
    expect(body).toMatch(/(?:^|\s)mask:\s*url\(/);
    expect(body).toMatch(/-webkit-mask:\s*url\(/);
    expect(body).toContain("var(--echo-duration-fast, 120ms)");
    expect(body).toContain("var(--echo-ease, cubic-bezier(0.2, 0.8, 0.2, 1))");
    expect(css).toMatch(
      /details\[open\]\s*>\s*summary:not\(\.list-none\)::before\s*\{\s*transform:\s*rotate\(90deg\);/,
    );
    expect(css).toMatch(
      /prefers-reduced-motion:\s*reduce\)\s*\{\s*summary:not\(\.list-none\)::before\s*\{\s*transition:\s*none;/,
    );
  });

  it("registers the border tiers so border-border-* utilities compile", () => {
    for (const tier of ["subtle", "default", "strong"]) {
      expect(css).toContain(`--color-border-${tier}: var(--border-${tier});`);
      expect(css).toMatch(
        new RegExp(`--border-${tier}: color-mix\\(in oklab, var\\(--border\\)`),
      );
    }
  });
});
