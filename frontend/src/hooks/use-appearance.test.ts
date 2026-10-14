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

  it.each([
    "rouge",
    "steel",
    "apricot",
    "violet",
    "mint",
    "teal",
    "emerald",
    "amber",
    "custom",
  ])("migrates a stored %s palette to ECHO", (stored) => {
    window.localStorage.setItem("echo-palette", stored);
    window.localStorage.setItem("echo-custom-color", "#336699");
    root().dataset.theme = stored;
    root().style.setProperty("--primary", "#336699");

    const { result } = renderHook(() => useAppearance());

    expect(result.current.palette).toBe("echo");
    expect(root().dataset.theme).toBeUndefined();
    expect(root().style.getPropertyValue("--primary")).toBe("");
    expect(window.localStorage.getItem("echo-palette")).toBe("echo");
    expect(window.localStorage.getItem("echo-custom-color")).toBeNull();
  });

  it("keeps ECHO when set explicitly", () => {
    const { result } = renderHook(() => useAppearance());
    act(() => result.current.setPalette("echo"));
    expect(root().dataset.theme).toBeUndefined();
    expect(window.localStorage.getItem("echo-palette")).toBe("echo");
  });
});
