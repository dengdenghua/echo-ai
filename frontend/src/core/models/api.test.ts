import { afterEach, expect, it, vi } from "vitest";
import { loadModels } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("lists only the LLM catalog and never asks for the official catalog", async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      models: [
        { name: "qwen", entry_id: "my-api", selection_id: "api-route" },
        { name: "official/qwen", entry_id: "official" },
      ],
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  const models = await loadModels();
  expect(models).toEqual([
    { name: "qwen", entry_id: "my-api", selection_id: "api-route" },
  ]);
  expect(
    fetchMock.mock.calls.some((call) =>
      String((call as unknown[])[0]).includes("/api/oct/"),
    ),
  ).toBe(false);
});
