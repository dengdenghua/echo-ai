import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";

// The desktop shell's store installer (CommonJS, shipped with Electron).
const store = createRequire(import.meta.url)(
  "../../../electron/extension-store.cjs",
) as {
  parseStoreInput(input: string): { store: string | null; id: string } | null;
  crxDownloadUrls(
    parsed: { store: string | null; id: string },
    chromeVersion: string,
  ): string[];
  crxZip(buffer: Buffer): Buffer;
  extractZip(zip: Buffer, destDir: string): number;
};

const ID = "ddkjiahejlhfcafbddmgiahcphecmpfh";

/** Minimal zip writer: deflated entries, enough for the reader. */
function makeZip(files: Record<string, string | null>) {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, "utf8");
    const raw = Buffer.from(text ?? "", "utf8");
    const data = text === null ? Buffer.alloc(0) : zlib.deflateRawSync(raw);
    const method = text === null ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(method, 10);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(nameBuf.length, 28);
    header.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    central.push(header, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

function makeCrx3(zip: Buffer) {
  const header = Buffer.from("signed-header-bytes");
  const prefix = Buffer.alloc(12);
  prefix.write("Cr24", 0, "latin1");
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return Buffer.concat([prefix, header, zip]);
}

describe("parseStoreInput", () => {
  it("reads IDs from both stores' links and bare IDs", () => {
    expect(
      store.parseStoreInput(
        `https://chromewebstore.google.com/detail/ublock-origin-lite/${ID}`,
      ),
    ).toEqual({ store: "chrome", id: ID });
    expect(
      store.parseStoreInput(
        `https://microsoftedge.microsoft.com/addons/detail/x/${ID}?hl=zh-CN`,
      ),
    ).toEqual({ store: "edge", id: ID });
    expect(store.parseStoreInput(` ${ID} `)).toEqual({ store: null, id: ID });
  });

  it("rejects other hosts, plain http and bad IDs", () => {
    expect(store.parseStoreInput(`https://evil.example/detail/${ID}`)).toBe(
      null,
    );
    expect(
      store.parseStoreInput(`http://chromewebstore.google.com/detail/${ID}`),
    ).toBe(null);
    expect(store.parseStoreInput("not-an-id")).toBe(null);
  });

  it("always downloads from the store endpoints", () => {
    const urls = store.crxDownloadUrls({ store: null, id: ID }, "140.0.1");
    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(/^https:\/\/clients2\.google\.com\/.*id%3D/);
    expect(urls[1]).toMatch(/^https:\/\/edge\.microsoft\.com\//);
  });
});

describe("crxZip + extractZip", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "echo-crx-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("unpacks the extension and skips _metadata", () => {
    const zip = makeZip({
      "manifest.json": '{"name":"x"}',
      "js/": null,
      "js/a.js": "console.log(1)",
      "_metadata/verified_contents.json": "{}",
    });
    const target = path.join(dir, "ext");
    expect(store.extractZip(store.crxZip(makeCrx3(zip)), target)).toBe(2);
    expect(readFileSync(path.join(target, "js/a.js"), "utf8")).toBe(
      "console.log(1)",
    );
    expect(existsSync(path.join(target, "_metadata"))).toBe(false);
  });

  it("refuses entries that escape the folder", () => {
    const zip = makeZip({
      "manifest.json": "{}",
      "../evil.js": "x",
    });
    expect(() => store.extractZip(zip, path.join(dir, "ext"))).toThrow(
      /unsafe path/,
    );
    expect(existsSync(path.join(dir, "evil.js"))).toBe(false);
  });

  it("rejects non-CRX data and packages without a manifest", () => {
    expect(() => store.crxZip(Buffer.from("PK\u0003\u0004 not a crx"))).toThrow(
      /not a CRX/,
    );
    expect(() =>
      store.extractZip(makeZip({ "a.js": "1" }), path.join(dir, "ext")),
    ).toThrow(/no manifest/);
  });
});
