import { describe, expect, it } from "vitest";

import { electronFindOptions } from "./find-in-page-options";

describe("electronFindOptions", () => {
  it("starts a new Electron find session for a new query", () => {
    expect(electronFindOptions({ forward: true, findNext: false })).toEqual({
      forward: true,
      findNext: true,
    });
  });

  it("continues the session for next / previous", () => {
    expect(electronFindOptions({ forward: false, findNext: true })).toEqual({
      forward: false,
      findNext: false,
    });
  });
});
