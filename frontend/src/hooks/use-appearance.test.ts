import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useAppearance } from "./use-appearance";

const root = () => document.documentElement;

beforeEach(() => {
  window.localStorage.clear();
  delete root().dataset.theme;
  root().removeAttribute("style");
});

afterEach(() => {
  window.localStorage.clear();
  delete root().dataset.theme;
  root().removeAttribute("style");
});

describe("useAppearance palette", () => {
  it("defaults to the ECHO palette, the unscoped base theme", () => {
    const { result } = renderHook(() => useAppearance());
    expect(result.current.palette).toBe("echo");
    expect(root().dataset.theme).toBeUndefined();
  });

  it("keeps a previously stored palette", () => {
    window.localStorage.setItem("echo-palette", "violet");
    const { result } = renderHook(() => useAppearance());
    expect(result.current.palette).toBe("violet");
    expect(root().dataset.theme).toBe("violet");
  });

  it("scopes the legacy rouge base instead of treating it as the default", () => {
    window.localStorage.setItem("echo-palette", "rouge");
    renderHook(() => useAppearance());
    expect(root().dataset.theme).toBe("rouge");
  });

  it("returns to ECHO by clearing the palette scope", () => {
    window.localStorage.setItem("echo-palette", "steel");
    const { result } = renderHook(() => useAppearance());
    expect(root().dataset.theme).toBe("steel");

    act(() => result.current.setPalette("echo"));
    expect(root().dataset.theme).toBeUndefined();
    expect(window.localStorage.getItem("echo-palette")).toBe("echo");
  });

  it("builds a custom color on the legacy base", () => {
    const { result } = renderHook(() => useAppearance());
    act(() => result.current.setCustomColor("#336699"));
    expect(root().dataset.theme).toBe("rouge");
    expect(root().style.getPropertyValue("--primary")).toBe("#336699");
  });
});
