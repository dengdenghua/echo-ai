import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHUNK_BYTES,
  downloadPhoneFile,
  sha256,
  uploadPhoneFile,
} from "./phone-mirror-api";
vi.mock("@/core/auth/api", () => ({
  authHeaders: () => ({ Authorization: "Bearer test" }),
}));
afterEach(() => vi.unstubAllGlobals());

describe("binary phone transfers", () => {
  it("resumes an acknowledged upload and confirms completion", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const bytes = new Uint8Array(CHUNK_BYTES * 2 + 7).map(
      (_, index) => index % 251,
    );
    const file = {
      name: "binary.bin",
      size: bytes.length,
      arrayBuffer: async () => bytes.buffer,
    } as File;
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        expect(init.headers.Authorization).toBe("Bearer test");
        const args = JSON.parse(init.body);
        calls.push(args);
        let body;
        if (args.operation === "begin")
          body = { id: "upload", offset: CHUNK_BYTES };
        else if (args.operation === "chunk") {
          const chunk = Uint8Array.from(atob(args.data), (char) =>
            char.charCodeAt(0),
          );
          expect(chunk).toEqual(
            bytes.slice(args.offset, args.offset + chunk.length),
          );
          body = { offset: args.offset + chunk.length };
        } else body = { name: file.name, size: file.size };
        return { ok: true, json: async () => body };
      }),
    );
    await uploadPhoneFile(
      "real-phone",
      file,
      vi.fn(),
      new AbortController().signal,
    );
    expect(calls.filter((call) => call.operation === "chunk")).toHaveLength(2);
    expect(calls.at(-1)?.operation).toBe("complete");
  });
  it("checks download hash and rejects corrupt contents", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const bytes = new Uint8Array([0, 255, 2, 0]);
    const hash = await sha256(bytes);
    let corrupt = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const args = JSON.parse(init.body);
        return {
          ok: true,
          json: async () =>
            args.operation === "stat"
              ? { size: bytes.length, sha256: hash }
              : {
                  data: btoa(
                    String.fromCharCode(...(corrupt ? [1, 2, 3, 4] : bytes)),
                  ),
                },
        };
      }),
    );
    expect(
      (
        await downloadPhoneFile(
          "phone",
          { name: "a.bin", size: 4 },
          vi.fn(),
          new AbortController().signal,
        )
      ).size,
    ).toBe(4);
    corrupt = true;
    await expect(
      downloadPhoneFile(
        "phone",
        { name: "a.bin", size: 4 },
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toThrow("文件校验失败");
  });
});
