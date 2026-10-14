/**
 * Installing a browser extension from the Chrome Web Store or Edge Add-ons.
 *
 * Only the extension ID comes from the user (a store link or a bare ID);
 * the package is always fetched from the store's own update endpoint. A
 * CRX is a header plus a zip; the zip is unpacked here with zlib because
 * the packaged app ships no third-party modules.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const EXTENSION_ID = /^[a-p]{32}$/;
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;

const STORES = {
  chrome: {
    hosts: ["chromewebstore.google.com", "chrome.google.com"],
    crxUrl: (id, chromeVersion) =>
      `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${encodeURIComponent(
        chromeVersion || "140.0.0.0",
      )}&acceptformat=crx2,crx3&x=id%3D${id}%26uc`,
  },
  edge: {
    hosts: ["microsoftedge.microsoft.com"],
    crxUrl: (id) =>
      `https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&prod=chromiumcrx&prodchannel=&x=id%3D${id}%26installsource%3Dondemand%26uc`,
  },
};

/** A store link or bare ID → { store, id }; a bare ID tries both stores. */
function parseStoreInput(input) {
  const text = String(input || "").trim();
  if (EXTENSION_ID.test(text)) return { store: null, id: text };
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const store = Object.keys(STORES).find((name) =>
    STORES[name].hosts.includes(url.hostname),
  );
  if (!store) return null;
  const id = url.pathname
    .split("/")
    .reverse()
    .find((part) => EXTENSION_ID.test(part));
  return id ? { store, id } : null;
}

/** Download URLs to try, in order. */
function crxDownloadUrls(parsed, chromeVersion) {
  const stores = parsed.store ? [parsed.store] : ["chrome", "edge"];
  return stores.map((name) => STORES[name].crxUrl(parsed.id, chromeVersion));
}

/** The zip inside a CRX (version 2 or 3). */
function crxZip(buffer) {
  if (buffer.length < 16 || buffer.toString("latin1", 0, 4) !== "Cr24") {
    throw new Error("not a CRX package");
  }
  const version = buffer.readUInt32LE(4);
  let start;
  if (version === 3) start = 12 + buffer.readUInt32LE(8);
  else if (version === 2)
    start = 16 + buffer.readUInt32LE(8) + buffer.readUInt32LE(12);
  else throw new Error(`unsupported CRX version ${version}`);
  if (start >= buffer.length) throw new Error("truncated CRX package");
  return buffer.subarray(start);
}

/**
 * Unpack a zip into destDir. Entries escaping destDir are refused;
 * `_metadata` (store signatures) is skipped because Chromium refuses to
 * load an unpacked extension that contains it.
 */
function extractZip(zip, destDir) {
  const root = path.resolve(destDir);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("damaged extension package");
  const count = zip.readUInt16LE(eocd + 10);
  let pointer = zip.readUInt32LE(eocd + 16);
  let written = 0;
  let files = 0;
  for (let n = 0; n < count; n += 1) {
    if (zip.readUInt32LE(pointer) !== 0x02014b50)
      throw new Error("damaged extension package");
    const method = zip.readUInt16LE(pointer + 10);
    const compressedSize = zip.readUInt32LE(pointer + 20);
    const size = zip.readUInt32LE(pointer + 24);
    const nameLength = zip.readUInt16LE(pointer + 28);
    const extraLength = zip.readUInt16LE(pointer + 30);
    const commentLength = zip.readUInt16LE(pointer + 32);
    const localOffset = zip.readUInt32LE(pointer + 42);
    const name = zip
      .toString("utf8", pointer + 46, pointer + 46 + nameLength)
      .replace(/\\/g, "/");
    pointer += 46 + nameLength + extraLength + commentLength;
    if (name === "_metadata/" || name.startsWith("_metadata/")) continue;
    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep))
      throw new Error(`unsafe path in extension package: ${name}`);
    if (name.endsWith("/")) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    if (zip.readUInt32LE(localOffset) !== 0x04034b50)
      throw new Error("damaged extension package");
    const dataStart =
      localOffset +
      30 +
      zip.readUInt16LE(localOffset + 26) +
      zip.readUInt16LE(localOffset + 28);
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    let content;
    if (method === 0) content = data;
    else if (method === 8) content = zlib.inflateRawSync(data);
    else throw new Error(`unsupported compression in ${name}`);
    if (content.length !== size) throw new Error(`damaged file ${name}`);
    written += content.length;
    if (written > MAX_UNPACKED_BYTES)
      throw new Error("extension package is too large");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    files += 1;
  }
  if (!fs.existsSync(path.join(root, "manifest.json")))
    throw new Error("extension package has no manifest.json");
  return files;
}

module.exports = {
  EXTENSION_ID,
  parseStoreInput,
  crxDownloadUrls,
  crxZip,
  extractZip,
};
