import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CATEGORICAL_SLOTS,
  categoricalSlot,
  categoricalSnowHex,
  categoricalVar,
  resolveCategoricalRamp,
} from "./categorical-palette";

const globalsCss = readFileSync(
  join(process.cwd(), "src/styles/globals.css"),
  "utf8",
).replace(/\r\n/g, "\n");

function rampIn(selector: string): string[] {
  const start = globalsCss.indexOf(`${selector} {\n  --cat-1`);
  expect(start, `${selector} declares the ramp`).toBeGreaterThan(-1);
  const block = globalsCss.slice(start, globalsCss.indexOf("}", start));
  return [...block.matchAll(/--cat-\d: (#[0-9a-f]{6});/g)].map((m) => m[1]);
}

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

describe("categorical palette", () => {
  it("maps a key to the same slot every time", () => {
    const slot = categoricalSlot("person");
    expect(categoricalSlot("person")).toBe(slot);
    expect(slot).toBeGreaterThanOrEqual(1);
    expect(slot).toBeLessThanOrEqual(CATEGORICAL_SLOTS);
    expect(categoricalVar(slot)).toBe(`var(--cat-${slot})`);
  });

  it("spreads keys over every slot", () => {
    const slots = new Set(
      Array.from({ length: 60 }, (_, i) => categoricalSlot(`type-${i}`)),
    );
    expect(slots.size).toBe(CATEGORICAL_SLOTS);
  });

  it("declares six literal hex values for Snow and Graphite", () => {
    const snow = rampIn(':root,\n[data-echo-theme="snow"]');
    const graphite = rampIn('.dark,\n[data-echo-theme="graphite"]');
    expect(snow).toHaveLength(CATEGORICAL_SLOTS);
    expect(graphite).toHaveLength(CATEGORICAL_SLOTS);
    expect(new Set([...snow, ...graphite]).size).toBe(CATEGORICAL_SLOTS * 2);
  });

  it("hands out Snow hex for colours that leave the client", () => {
    const snow = rampIn(':root,\n[data-echo-theme="snow"]');
    for (const slot of [1, 2, 3, 4, 5, 6] as const) {
      expect(categoricalSnowHex(slot)).toBe(snow[slot - 1]);
    }
  });

  it("reads the ramp in force for canvas consumers", () => {
    document.documentElement.style.setProperty("--cat-1", "#82ccd5");
    const ramp = resolveCategoricalRamp(document.documentElement);
    expect(ramp).toHaveLength(CATEGORICAL_SLOTS);
    expect(ramp[0]).toBe("#82ccd5");
    // Unset slots fall back to the Snow values.
    expect(ramp[1]).toMatch(/^#[0-9a-f]{6}$/);
  });
});
