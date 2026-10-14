/**
 * In-page translation for browser tabs (desktop app).
 *
 * `installPageTranslator` runs inside the tab's isolated world (Electron's
 * executeJavaScriptInIsolatedWorld): it shares the page's DOM but none of
 * its JavaScript, so page scripts can neither see nor break it. It is
 * injected as source text (`pageTranslatorSource`), so the function must stay
 * self-contained: no imports and no references to module scope.
 *
 * It only ever rewrites the `data` of text nodes and adds its own
 * `<echo-tr>` elements; it never moves or removes the page's elements, so
 * React-style pages keep working and links / bold text stay where they were.
 */

export type PageTranslationMode = "translated" | "bilingual" | "original";

/** The reader's language: pages are translated into it. */
export type PageTranslationTarget = "zh-CN" | "en-US" | "ja-JP" | "ko-KR";

export interface PageTranslationSegment {
  id: string;
  /** The paragraph's text nodes, in order; translations come back aligned. */
  pieces: string[];
  /** Per piece: "" for text directly in the paragraph, else the inline
   * element around it: a link, b bold, i italic, s other, t a plain piece
   * next to another plain piece (its boundary must survive). */
  kinds: string[];
}

export interface PageTranslationResult {
  id: string;
  pieces: string[];
}

export interface PageLanguageGuess {
  /** zh / ja / ko / ru / latin / unknown */
  lang: string;
  /** Not in the reader's language: worth offering a translation. */
  foreign: boolean;
  declared: string;
}

export interface PageTranslatorStatus {
  /** Changes with every document, so late replies never land on a new page. */
  doc: string;
  /** False until a pump found the page worth translating. */
  started: boolean;
  mode: PageTranslationMode;
  segments: number;
  done: number;
  pending: number;
  inflight: number;
  failed: number;
}

export interface PageTranslatorPump {
  status: PageTranslatorStatus;
  language: PageLanguageGuess;
  batch: PageTranslationSegment[];
}

export interface PageTranslatorApi {
  detect: (target: PageTranslationTarget) => PageLanguageGuess;
  start: (
    mode: PageTranslationMode,
    target: PageTranslationTarget,
  ) => PageTranslatorStatus;
  /** Starts on a foreign page if needed, then hands out the next batch. */
  pump: (
    mode: PageTranslationMode,
    target: PageTranslationTarget,
    maxSegments: number,
    maxChars: number,
  ) => PageTranslatorPump;
  take: (maxSegments: number, maxChars: number) => PageTranslationSegment[];
  apply: (
    doc: string,
    results: PageTranslationResult[],
  ) => PageTranslatorStatus;
  fail: (doc: string, ids: string[]) => PageTranslatorStatus;
  setMode: (mode: PageTranslationMode) => PageTranslatorStatus;
  status: () => PageTranslatorStatus;
  reset: () => void;
}

declare global {
  // The translator installed in this document's isolated world.
  var __echoPageTranslator: PageTranslatorApi | undefined;
}

export function installPageTranslator(): PageTranslatorApi {
  const existing = globalThis.__echoPageTranslator;
  if (existing) return existing;
  const isText = (node: Node): node is Text => node.nodeType === Node.TEXT_NODE;
  const isElement = (node: Node): node is Element =>
    node.nodeType === Node.ELEMENT_NODE;

  const SKIP = new Set([
    "script",
    "style",
    "noscript",
    "template",
    "code",
    "pre",
    "kbd",
    "samp",
    "var",
    "textarea",
    "input",
    "select",
    "option",
    "svg",
    "math",
    "canvas",
    "iframe",
    "object",
    "embed",
    "video",
    "audio",
    "echo-tr",
  ]);
  // A paragraph longer than this is sent as several segments.
  const MAX_SEGMENT_CHARS = 1500;
  // Short labels (menus, buttons) are replaced even in bilingual mode: a
  // second line under every nav item breaks the page's layout.
  const SHORT_LABEL_CHARS = 24;
  const MAX_ATTEMPTS = 2;

  type State = "pending" | "inflight" | "done" | "failed";
  interface Segment {
    id: string;
    block: Element;
    nodes: Text[];
    originals: string[];
    kinds: string[];
    translated: string[] | null;
    state: State;
    attempts: number;
    visible: boolean;
    bilingual: HTMLElement | null;
  }

  const segments = new Map<string, Segment>();
  const byBlock = new Map<Element, Segment[]>();
  // Last intersection state per block; segments added to a block later
  // inherit it instead of waiting for a change that may never come.
  const blockVisible = new WeakMap<Element, boolean>();
  const claimed = new WeakSet<Text>();
  const written = new WeakMap<Text, string>();
  const skipCache = new WeakMap<Element, boolean>();
  const displayCache = new WeakMap<Element, string>();
  let mode: PageTranslationMode = "original";
  let target: PageTranslationTarget = "zh-CN";
  let started = false;
  let language: PageLanguageGuess | null = null;
  const doc = Math.random().toString(36).slice(2, 10);
  let nextId = 1;
  let observer: IntersectionObserver | null = null;
  let mutations: MutationObserver | null = null;
  let rescanTimer: ReturnType<typeof setTimeout> | null = null;
  const dirty = new Set<Node>();

  const HAN = /[㐀-䶿一-鿿]/g;
  const KANA = /[぀-ヿ]/g;
  const HANGUL = /[가-힯]/g;
  const LATIN = /[A-Za-zÀ-ɏ]/g;
  const CYRILLIC = /[Ѐ-ӿ]/g;
  const count = (text: string, pattern: RegExp) =>
    (text.match(pattern) || []).length;

  interface Scripts {
    han: number;
    kana: number;
    hangul: number;
    latin: number;
    cyrillic: number;
  }

  function scripts(text: string): Scripts {
    return {
      han: count(text, HAN),
      kana: count(text, KANA),
      hangul: count(text, HANGUL),
      latin: count(text, LATIN),
      cyrillic: count(text, CYRILLIC),
    };
  }

  /** Already reads in the reader's language. Latin script alone cannot tell
   * English from French, so for English readers the page's declared
   * language decides. */
  function inTarget(
    found: Scripts,
    reader: PageTranslationTarget,
    declared: string,
  ): boolean {
    const { han, kana, hangul, latin, cyrillic } = found;
    switch (reader) {
      case "zh-CN":
        return kana === 0 && han * 2 >= latin + cyrillic + hangul;
      case "ja-JP":
        return kana > 0 || (hangul === 0 && han * 2 >= latin + cyrillic);
      case "ko-KR":
        return hangul * 2 >= latin + cyrillic + han + kana;
      default:
        return (
          han + kana + hangul + cyrillic === 0 &&
          (declared === "" || declared.startsWith("en"))
        );
    }
  }

  const declaredLang = () =>
    (document.documentElement.lang || "").toLowerCase();

  /** Text worth translating: letters, and not in the reader's language. */
  function foreignText(text: string): boolean {
    const found = scripts(text);
    const letters =
      found.han + found.kana + found.hangul + found.latin + found.cyrillic;
    if (letters < 2) return false;
    return !inTarget(found, target, declaredLang());
  }

  function skipped(element: Element | null): boolean {
    if (!element) return true;
    const cached = skipCache.get(element);
    if (cached !== undefined) return cached;
    const name = element.localName;
    let result =
      SKIP.has(name) ||
      element.getAttribute("translate") === "no" ||
      element.classList.contains("notranslate") ||
      (element instanceof HTMLElement && element.isContentEditable);
    if (!result && element.parentElement) {
      result = skipped(element.parentElement);
    }
    skipCache.set(element, result);
    return result;
  }

  function displayOf(element: Element): string {
    let value = displayCache.get(element);
    if (value === undefined) {
      value = getComputedStyle(element).display || "inline";
      displayCache.set(element, value);
    }
    return value;
  }

  function blockOf(element: Element): Element {
    let current: Element = element;
    while (
      current.parentElement &&
      current !== document.body &&
      (displayOf(current) === "inline" || displayOf(current) === "contents")
    ) {
      current = current.parentElement;
    }
    return current;
  }

  /** The block's child that contains `node`, so the bilingual line lands
   * after the original text instead of inside a link. */
  function kindOf(node: Text, block: Element): string {
    let kind = "";
    for (
      let element = node.parentElement;
      element && element !== block;
      element = element.parentElement
    ) {
      const name = element.localName;
      if (name === "a") return "a";
      if (!kind) {
        kind =
          name === "b" || name === "strong"
            ? "b"
            : name === "i" || name === "em"
              ? "i"
              : "s";
      }
    }
    return kind;
  }

  function kindsOf(nodes: Text[], block: Element): string[] {
    const raw = nodes.map((node) => kindOf(node, block));
    return raw.map((kind, index) =>
      kind === "" &&
      ((index > 0 && raw[index - 1] === "") ||
        (index + 1 < raw.length && raw[index + 1] === ""))
        ? "t"
        : kind,
    );
  }

  function topChild(block: Element, node: Node): Node {
    let current: Node = node;
    while (current.parentNode && current.parentNode !== block) {
      current = current.parentNode;
    }
    return current;
  }

  function register(block: Element, nodes: Text[]) {
    let start = 0;
    while (start < nodes.length) {
      let end = start;
      let chars = 0;
      while (end < nodes.length) {
        const length = nodes[end]!.data.length;
        if (end > start && chars + length > MAX_SEGMENT_CHARS) break;
        chars += length;
        end += 1;
      }
      const chunk = nodes.slice(start, end);
      start = end;
      const text = chunk.map((node) => node.data).join("");
      if (!foreignText(text)) continue;
      const segment: Segment = {
        id: String(nextId++),
        block,
        nodes: chunk,
        originals: chunk.map((node) => node.data),
        kinds: kindsOf(chunk, block),
        translated: null,
        state: "pending",
        attempts: 0,
        visible: blockVisible.get(block) ?? !observer,
        bilingual: null,
      };
      for (const node of chunk) claimed.add(node);
      segments.set(segment.id, segment);
      const list = byBlock.get(block);
      if (list) {
        list.push(segment);
      } else {
        byBlock.set(block, [segment]);
        observer?.observe(block);
      }
    }
  }

  function scan(root: Node) {
    if (!document.body) return;
    const start =
      root.nodeType === Node.TEXT_NODE ? root.parentNode || root : root;
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT);
    const groups = new Map<Element, Text[]>();
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!isText(text) || claimed.has(text) || !text.data.trim()) continue;
      const parent = text.parentElement;
      if (!parent || skipped(parent)) continue;
      const block = blockOf(parent);
      const group = groups.get(block);
      if (group) group.push(text);
      else groups.set(block, [text]);
    }
    for (const [block, nodes] of groups) register(block, nodes);
  }

  function write(node: Text, value: string) {
    if (node.data === value) return;
    written.set(node, value);
    node.data = value;
  }

  function dropBilingual(segment: Segment) {
    segment.bilingual?.remove();
    segment.bilingual = null;
  }

  function render(segment: Segment) {
    const translated = segment.translated;
    const original = segment.originals.join("");
    const view =
      !translated || mode === "original"
        ? "original"
        : mode === "bilingual" && original.trim().length > SHORT_LABEL_CHARS
          ? "bilingual"
          : "translated";
    if (view === "translated" && translated) {
      segment.nodes.forEach((node, index) =>
        write(node, translated[index] ?? ""),
      );
      dropBilingual(segment);
      return;
    }
    segment.nodes.forEach((node, index) =>
      write(node, segment.originals[index] ?? ""),
    );
    if (view !== "bilingual" || !translated) {
      dropBilingual(segment);
      return;
    }
    if (!segment.bilingual) {
      const line = document.createElement("echo-tr");
      line.setAttribute("translate", "no");
      line.setAttribute("lang", target);
      line.style.display = "block";
      line.style.marginTop = "0.25em";
      line.style.opacity = "0.86";
      const last = segment.nodes[segment.nodes.length - 1]!;
      const anchor = topChild(segment.block, last);
      if (anchor.parentNode === segment.block) {
        segment.block.insertBefore(line, anchor.nextSibling);
      } else {
        segment.block.append(line);
      }
      segment.bilingual = line;
    }
    segment.bilingual.textContent = translated.join("");
  }

  function status(): PageTranslatorStatus {
    let done = 0;
    let pending = 0;
    let inflight = 0;
    let failed = 0;
    for (const segment of segments.values()) {
      if (segment.state === "done") done += 1;
      else if (segment.state === "inflight") inflight += 1;
      else if (segment.state === "failed") failed += 1;
      else pending += 1;
    }
    return {
      doc,
      started,
      mode,
      segments: segments.size,
      done,
      pending,
      inflight,
      failed,
    };
  }

  /** A text node the page rewrote itself (e.g. a React update): its segment
   * starts over from the new text. */
  function refresh(node: Text) {
    if (written.get(node) === node.data) return;
    for (const segment of segments.values()) {
      const index = segment.nodes.indexOf(node);
      if (index < 0) continue;
      segment.originals[index] = node.data;
      if (segment.state === "done" || segment.state === "failed") {
        segment.state = "pending";
        segment.attempts = 0;
      }
      segment.translated = null;
      dropBilingual(segment);
      return;
    }
  }

  function flushDirty() {
    rescanTimer = null;
    const roots = [...dirty];
    dirty.clear();
    for (const root of roots) {
      if (root.isConnected) scan(root);
    }
  }

  function watch() {
    if (typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            blockVisible.set(entry.target, entry.isIntersecting);
            for (const segment of byBlock.get(entry.target) || []) {
              segment.visible = entry.isIntersecting;
            }
          }
        },
        // Fetch a screen ahead so scrolling rarely shows the original.
        { rootMargin: "100% 0px 100% 0px" },
      );
    }
    if (typeof MutationObserver === "function" && document.body) {
      mutations = new MutationObserver((records) => {
        for (const record of records) {
          const target = record.target;
          if (isElement(target) && target.localName === "echo-tr") continue;
          if (record.type === "characterData") {
            if (isText(target)) refresh(target);
            continue;
          }
          for (const added of record.addedNodes) {
            if (isElement(added) && added.localName === "echo-tr") continue;
            dirty.add(added);
          }
        }
        if (dirty.size && rescanTimer === null) {
          rescanTimer = setTimeout(flushDirty, 400);
        }
      });
      mutations.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
  }

  const api: PageTranslatorApi = {
    detect(reader) {
      const declared = declaredLang();
      const body = document.body;
      // innerText skips hidden text and scripts; textContent is the fallback
      // where layout is unavailable.
      const sample = (
        (body && (body.innerText ?? body.textContent)) ||
        ""
      ).slice(0, 6000);
      const found = scripts(sample);
      const { han, kana, hangul, latin, cyrillic } = found;
      const letters = han + kana + hangul + latin + cyrillic;
      let lang = "unknown";
      if (kana >= 20) lang = "ja";
      else if (hangul >= 20 && hangul > han) lang = "ko";
      else if (letters > 0 && han / letters >= 0.3) lang = "zh";
      else if (cyrillic > latin && cyrillic >= 40) lang = "ru";
      else if (latin >= 40) lang = "latin";
      const foreign =
        lang !== "unknown" &&
        letters >= 40 &&
        !inTarget(found, reader, declared);
      return { lang, foreign, declared };
    },
    start(next, reader) {
      mode = next;
      if (!started) {
        target = reader;
        started = true;
        watch();
        scan(document.body);
      }
      for (const segment of segments.values()) render(segment);
      return status();
    },
    pump(next, reader, maxSegments, maxChars) {
      language = language || api.detect(reader);
      if (!started && language.foreign) api.start(next, reader);
      else if (started && next !== mode) api.setMode(next);
      const batch = started ? api.take(maxSegments, maxChars) : [];
      return { status: status(), language, batch };
    },
    take(maxSegments, maxChars) {
      const batch: PageTranslationSegment[] = [];
      let chars = 0;
      for (const segment of segments.values()) {
        if (batch.length >= maxSegments) break;
        if (segment.state !== "pending" || !segment.visible) continue;
        if (!segment.block.isConnected) continue;
        const size = segment.originals.join("").length;
        if (batch.length > 0 && chars + size > maxChars) break;
        chars += size;
        segment.state = "inflight";
        segment.attempts += 1;
        batch.push({
          id: segment.id,
          pieces: [...segment.originals],
          kinds: [...segment.kinds],
        });
      }
      return batch;
    },
    apply(target, results) {
      if (target !== doc) return status();
      for (const result of results) {
        const segment = segments.get(result.id);
        if (!segment || segment.state !== "inflight") continue;
        const pieces = Array.isArray(result.pieces)
          ? result.pieces.map((piece) => String(piece ?? ""))
          : [];
        const joined = pieces.join("");
        if (!joined.trim()) {
          // Never blank out the original for an empty answer.
          segment.state =
            segment.attempts >= MAX_ATTEMPTS ? "failed" : "pending";
          continue;
        }
        // Pieces that do not line up with the text nodes all go into the
        // first node; the paragraph still reads right, links keep their
        // place but lose their own words.
        segment.translated =
          pieces.length === segment.nodes.length
            ? pieces
            : [joined, ...segment.nodes.slice(1).map(() => "")];
        segment.state = "done";
        render(segment);
      }
      return status();
    },
    fail(target, ids) {
      if (target !== doc) return status();
      for (const id of ids) {
        const segment = segments.get(id);
        if (!segment || segment.state !== "inflight") continue;
        segment.state = segment.attempts >= MAX_ATTEMPTS ? "failed" : "pending";
      }
      return status();
    },
    setMode(next) {
      mode = next;
      for (const segment of segments.values()) render(segment);
      return status();
    },
    status,
    reset() {
      mode = "original";
      for (const segment of segments.values()) render(segment);
      observer?.disconnect();
      mutations?.disconnect();
      if (rescanTimer !== null) clearTimeout(rescanTimer);
      globalThis.__echoPageTranslator = undefined;
    },
  };
  globalThis.__echoPageTranslator = api;
  return api;
}

/** Marker returned when the document has no translator yet (a new page). */
export const PAGE_TRANSLATOR_MISSING = "__echo_page_translator_missing__";

/** Calls the translator already installed in this document, or reports
 * that it is missing without shipping the whole script again. */
export function pageTranslatorCall(call: string): string {
  return `(() => { const t = globalThis.__echoPageTranslator; return t ? t.${call} : ${JSON.stringify(PAGE_TRANSLATOR_MISSING)}; })()`;
}

/** Installs the translator in this document, then makes `call`. */
export function pageTranslatorInstall(call: string): string {
  return `(${installPageTranslator.toString()})().${call}`;
}
