import { createRequire } from "node:module";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  symlink,
  lstat,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

// Test the exact patched dependency used by Electron's installer.
const require = createRequire(import.meta.url);
const electronRequire = createRequire(require.resolve("electron/package.json"));
const extract = electronRequire("extract-zip") as (
  file: string,
  options: { dir: string; onEntry?: (entry: { fileName: string }) => void },
) => Promise<void>;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function crc32(bytes: Buffer) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

// Stored ZIP entries with explicit Unix mode bits, including duplicate names.
function zip(entries: { name: string; data: string; link?: boolean }[]) {
  const files: Buffer[] = [],
    index: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      data = Buffer.from(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x0314, 4);
    header.copy(central, 6, 4, 28);
    central.writeUInt32LE(((entry.link ? 0o120777 : 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    files.push(header, name, data);
    index.push(central, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(index),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, directory, end]);
}

async function fixture(entries: Parameters<typeof zip>[0]) {
  const root = await mkdtemp(path.join(tmpdir(), "echo-extract-test-"));
  roots.push(root);
  const archive = path.join(root, "input.zip"),
    dir = path.join(root, "output");
  await writeFile(archive, zip(entries));
  await mkdir(dir);
  return { root, archive, dir };
}

it.each(["../outside.txt", "/tmp/outside.txt", "C:\\outside.txt"])(
  "blocks symlink target %s before creating it",
  async (target) => {
    const { root, archive, dir } = await fixture([
      { name: "link", data: target, link: true },
      { name: "link", data: "overwrite" },
    ]);
    await writeFile(path.join(root, "outside.txt"), "untouched");
    await expect(extract(archive, { dir })).rejects.toThrow();
    expect(await readFile(path.join(root, "outside.txt"), "utf8")).toBe(
      "untouched",
    );
    await expect(lstat(path.join(dir, "link"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("does not create directories through an existing outside junction", async () => {
  const { root, archive, dir } = await fixture([
    { name: "link/new/entry", data: "bad" },
  ]);
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await symlink(outside, path.join(dir, "link"), "junction");
  await expect(extract(archive, { dir })).rejects.toThrow();
  await expect(lstat(path.join(outside, "new"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("rejects a final-component link instead of following it", async () => {
  const { root, archive, dir } = await fixture([
    { name: "entry", data: "bad" },
  ]);
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await symlink(outside, path.join(dir, "entry"), "junction");
  await expect(extract(archive, { dir })).rejects.toThrow(
    /Refusing to overwrite/,
  );
  expect((await lstat(path.join(dir, "entry"))).isSymbolicLink()).toBe(true);
});

it.each(["parent", "target"])(
  "resolves %s aliases before processing link traversal",
  async (aliasLocation) => {
    const { archive, dir } = await fixture([
      {
        name: aliasLocation === "parent" ? "alias/escape" : "escape",
        data: aliasLocation === "parent" ? "../outside" : "alias/../outside",
        link: true,
      },
    ]);
    await symlink(dir, path.join(dir, "alias"), "junction");
    await expect(extract(archive, { dir })).rejects.toThrow(/Out of bound/);
    await expect(lstat(path.join(dir, "escape"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("revalidates filenames changed by an onEntry callback", async () => {
  const { root, archive, dir } = await fixture([{ name: "safe", data: "bad" }]);
  await expect(
    extract(archive, {
      dir,
      onEntry: (entry) => {
        entry.fileName = "../escape/new/file";
      },
    }),
  ).rejects.toThrow();
  await expect(lstat(path.join(root, "escape"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("extracts normal files and can replace a previous regular file", async () => {
  const { archive, dir } = await fixture([
    { name: "folder/file", data: "hello" },
  ]);
  await extract(archive, { dir });
  await extract(archive, { dir });
  expect(await readFile(path.join(dir, "folder/file"), "utf8")).toBe("hello");
});

it.skipIf(process.platform === "win32")(
  "preserves confined framework links and rejects a duplicate file over a link",
  async () => {
    const { archive, dir } = await fixture([
      { name: "Versions/A/binary", data: "executable" },
      { name: "Versions/Current", data: "A", link: true },
      { name: "binary", data: "Versions/Current/binary", link: true },
    ]);
    await extract(archive, { dir });
    expect(await readFile(path.join(dir, "binary"), "utf8")).toBe("executable");
    await writeFile(archive, zip([{ name: "binary", data: "overwrite" }]));
    await expect(extract(archive, { dir })).rejects.toThrow(
      /Refusing to overwrite/,
    );
    expect(await readFile(path.join(dir, "Versions/A/binary"), "utf8")).toBe(
      "executable",
    );
  },
);
