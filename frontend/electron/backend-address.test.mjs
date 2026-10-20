import { describe, expect, it } from "vitest";
import backendAddress from "./backend-address.cjs";

describe("backend address resolution", () => {
  it("normal installed startup separates desktop from the developer backend", () => {
    expect(backendAddress.backendBaseURL(true)).toBe("http://127.0.0.1:18310");
    expect(backendAddress.backendPort(true)).toBe("18310");
    expect(backendAddress.backendBaseURL(false)).toBe("http://127.0.0.1:8310");
    expect(backendAddress.backendPort(false)).toBe("8310");
  });

  it("renderer and process agree on validated explicit loopback overrides", () => {
    expect(backendAddress.backendBaseURL(true, "http://localhost:19410/")).toBe(
      "http://localhost:19410",
    );
    expect(backendAddress.backendPort(true, "http://localhost:19410/")).toBe(
      "19410",
    );
    for (const override of [
      "https://example.com",
      "http://user:pass@localhost:8310",
      "http://localhost:8310/private",
    ]) {
      expect(() => backendAddress.backendBaseURL(true, override)).toThrow();
      expect(() => backendAddress.backendPort(true, override)).toThrow();
    }
  });
});
