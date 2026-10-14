import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  PAGE_TRANSLATOR_MISSING,
  pageTranslatorCall,
  pageTranslatorInstall,
  type PageTranslationSegment,
  type PageTranslatorApi,
  type PageTranslatorPump,
  type PageTranslatorStatus,
} from "./page-translator";

/** Runs source exactly as the isolated world would receive it. */
function run<T>(code: string): T {
  return new Function(`return ${code};`)() as T;
}

function translator(): PageTranslatorApi {
  run(pageTranslatorInstall("status()"));
  return (globalThis as unknown as Record<string, PageTranslatorApi>)
    .__echoPageTranslator!;
}

/** Every observed block is on screen. */
class VisibleObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

const originalObserver = window.IntersectionObserver;

beforeEach(() => {
  window.IntersectionObserver =
    VisibleObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  (
    globalThis as unknown as Record<string, PageTranslatorApi | undefined>
  ).__echoPageTranslator?.reset();
  document.body.innerHTML = "";
  document.documentElement.lang = "";
  window.IntersectionObserver = originalObserver;
});

function zh(segments: PageTranslationSegment[]) {
  return segments.map((segment) => ({
    id: segment.id,
    pieces: segment.pieces.map((piece) => `«${piece.trim()}»`),
  }));
}

describe("page translator", () => {
  test("the injected source is self-contained and reports a fresh page", () => {
    expect(run(pageTranslatorCall("status()"))).toBe(PAGE_TRANSLATOR_MISSING);
    const status = run<PageTranslatorStatus>(pageTranslatorInstall("status()"));
    expect(status).toMatchObject({ started: false, segments: 0 });
    expect(run<PageTranslatorStatus>(pageTranslatorCall("status()")).doc).toBe(
      status.doc,
    );
  });

  test("tells foreign pages from Chinese ones", () => {
    document.body.innerHTML = `<p>${"The quick brown fox jumps over the lazy dog. ".repeat(4)}</p>`;
    expect(translator().detect("zh-CN")).toMatchObject({
      lang: "latin",
      foreign: true,
    });
    translator().reset();
    document.body.innerHTML = `<p>${"这是一个中文网页，内容都是中文。".repeat(6)}</p>`;
    expect(translator().detect("zh-CN")).toMatchObject({
      lang: "zh",
      foreign: false,
    });
  });

  test("follows the reader's language", () => {
    document.body.innerHTML = `<p>${"这是一个中文网页，内容都是中文。".repeat(6)}</p>`;
    expect(translator().detect("en-US").foreign).toBe(true);
    translator().reset();

    document.body.innerHTML = `<p>${"Plain English text for an English reader. ".repeat(3)}</p>`;
    expect(translator().detect("en-US").foreign).toBe(false);
    translator().reset();

    // Latin script alone cannot tell French from English; the page says.
    document.documentElement.lang = "fr";
    document.body.innerHTML = `<p>${"Le texte de cette page est en français. ".repeat(3)}</p>`;
    expect(translator().detect("en-US").foreign).toBe(true);
    expect(translator().detect("ja-JP").foreign).toBe(true);
  });

  test("hands out paragraphs as their text nodes and skips code and Chinese", () => {
    document.body.innerHTML = `
      <p id="p">Click <a id="a" href="#">here</a> to continue.</p>
      <pre>const answer = 42;</pre>
      <p><code>npm install</code></p>
      <p>已经是中文的段落</p>
      <p translate="no">Brand Name</p>
      <script>var hidden = "do not translate";</script>`;
    const t = translator();
    t.start("translated", "zh-CN");

    const batch = t.take(20, 3000);

    expect(batch).toEqual([
      {
        id: expect.any(String),
        pieces: ["Click ", "here", " to continue."],
        kinds: ["", "a", ""],
      },
    ]);
  });

  test("tells links, bold and line breaks apart so their text keeps its place", () => {
    document.body.innerHTML = `
      <p><strong>Note:</strong> read <a href="#"><em>the guide</em></a> first.</p>
      <div>First line of the address<br>Second line of the address</div>`;
    const t = translator();
    t.start("translated", "zh-CN");

    const kinds = t.take(20, 3000).map((segment) => segment.kinds);

    expect(kinds).toEqual([
      ["b", "", "a", ""],
      ["t", "t"],
    ]);
  });

  test("writes translations into the same nodes and switches views without refetching", () => {
    const long = "This paragraph is long enough to earn a second line.";
    document.body.innerHTML = `
      <p id="p">Click <a id="a" href="#">here</a> to continue.</p>
      <p id="long">${long}</p>
      <nav><span id="label">Home</span></nav>`;
    const link = document.getElementById("a");
    const t = translator();
    const { doc } = t.start("translated", "zh-CN");

    t.apply(doc, zh(t.take(20, 3000)));

    expect(document.getElementById("p")!.textContent).toBe(
      "«Click»«here»«to continue.»",
    );
    expect(document.getElementById("a")).toBe(link);
    expect(link!.textContent).toBe("«here»");

    t.setMode("bilingual");
    const longBlock = document.getElementById("long")!;
    expect(longBlock.firstChild!.textContent).toBe(long);
    expect(longBlock.querySelector("echo-tr")!.textContent).toBe(`«${long}»`);
    // Short labels are replaced in place even in bilingual mode.
    expect(document.getElementById("label")!.textContent).toBe("«Home»");

    t.setMode("original");
    expect(document.getElementById("p")!.textContent).toBe(
      "Click here to continue.",
    );
    expect(document.querySelector("echo-tr")).toBeNull();
    expect(t.status()).toMatchObject({ done: 3, pending: 0 });
  });

  test("ignores replies meant for an earlier page and never blanks text", () => {
    document.body.innerHTML = `<p id="p">Read <b>the</b> manual first.</p>`;
    const t = translator();
    const { doc } = t.start("translated", "zh-CN");
    const [segment] = t.take(20, 3000);

    t.apply("old-page", zh([segment!]));
    expect(document.getElementById("p")!.textContent).toBe(
      "Read the manual first.",
    );

    t.apply(doc, [{ id: segment!.id, pieces: ["", "", ""] }]);
    expect(document.getElementById("p")!.textContent).toBe(
      "Read the manual first.",
    );
    expect(t.status()).toMatchObject({ pending: 1, done: 0 });

    const [again] = t.take(20, 3000);
    t.apply(doc, [{ id: again!.id, pieces: ["先读说明书。"] }]);
    // A reply that does not line up keeps the sentence in the first node.
    expect(document.getElementById("p")!.textContent).toBe("先读说明书。");
  });

  test("splits a long paragraph and only starts itself on foreign pages", () => {
    const sentence = "Sentence number one is right here. ";
    document.body.innerHTML = `<div id="d">${Array.from(
      { length: 60 },
      (_, i) => `${sentence}${i}<br>`,
    ).join("")}</div>`;
    const t = translator();

    const tick: PageTranslatorPump = t.pump("translated", "zh-CN", 40, 100_000);

    expect(tick.status.started).toBe(true);
    expect(tick.batch.length).toBeGreaterThan(1);
    for (const segment of tick.batch) {
      expect(segment.pieces.join("").length).toBeLessThanOrEqual(1500);
    }

    t.reset();
    document.body.innerHTML = `<p>${"完全是中文的页面内容。".repeat(10)}</p>`;
    const chinese = translator().pump("translated", "zh-CN", 40, 100_000);
    expect(chinese.status.started).toBe(false);
    expect(chinese.batch).toEqual([]);
  });

  test("shows a translation card under the selection and closes it on Escape", () => {
    document.body.innerHTML = `<p id="p">Select this sentence.</p>`;
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("p")!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const labels = {
      title: "译文",
      copy: "复制",
      copied: "已复制",
      close: "关闭",
    };
    const t = translator();

    t.bubble("loading", "正在翻译…", labels);
    const host = document.querySelector("echo-tr-bubble")!;
    expect(host.shadowRoot!.textContent).toContain("正在翻译…");

    t.bubble("text", "选中这句话。", labels);
    expect(document.querySelectorAll("echo-tr-bubble")).toHaveLength(1);
    expect(host.shadowRoot!.textContent).toContain("选中这句话。");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector("echo-tr-bubble")).toBeNull();
  });

  test("translates the title, placeholders and image descriptions", () => {
    document.title = "Release notes for the new version";
    document.body.innerHTML = `
      <p>The new version ships faster startup.</p>
      <input id="search" placeholder="Search the documentation" />
      <img id="pic" alt="A red bicycle by the lake" src="x.png" />
      <button id="tip" title="Opens the settings page"><svg></svg></button>
      <a id="link" href="#" title="Machine translation">Machine translation</a>`;
    const t = translator();
    const { doc } = t.start("translated", "zh-CN");

    const batch = t.take(20, 3000);
    expect(batch.map((segment) => segment.pieces[0])).toEqual(
      expect.arrayContaining([
        "Release notes for the new version",
        "Search the documentation",
        "A red bicycle by the lake",
        "Opens the settings page",
      ]),
    );
    // A link's tooltip repeats its words and is left alone.
    expect(
      batch.filter((segment) => segment.pieces[0] === "Machine translation"),
    ).toHaveLength(1);
    t.apply(doc, zh(batch));

    expect(document.title).toBe("«Release notes for the new version»");
    expect(document.getElementById("search")!.getAttribute("placeholder")).toBe(
      "«Search the documentation»",
    );
    expect(document.getElementById("pic")!.getAttribute("alt")).toBe(
      "«A red bicycle by the lake»",
    );
    // Attributes have no room for a second line, so bilingual keeps them
    // translated; the original view restores them.
    t.setMode("bilingual");
    expect(document.getElementById("tip")!.getAttribute("title")).toBe(
      "«Opens the settings page»",
    );
    t.setMode("original");
    expect(document.title).toBe("Release notes for the new version");
    expect(document.getElementById("search")!.getAttribute("placeholder")).toBe(
      "Search the documentation",
    );
    document.title = "";
  });

  test("reaches into same-origin frames", () => {
    document.body.innerHTML = `<p>Outer paragraph in English.</p><iframe id="f"></iframe>`;
    const frame = document.getElementById("f") as HTMLIFrameElement;
    frame.contentDocument!.body.innerHTML =
      "<p id='inner'>A paragraph inside the frame.</p>";
    const t = translator();
    const { doc } = t.start("translated", "zh-CN");

    const batch = t.take(20, 3000);
    expect(batch.map((segment) => segment.pieces.join(""))).toContain(
      "A paragraph inside the frame.",
    );
    t.apply(doc, zh(batch));

    const inner = frame.contentDocument!.getElementById("inner")!;
    expect(inner.textContent).toBe("«A paragraph inside the frame.»");
    t.setMode("original");
    expect(inner.textContent).toBe("A paragraph inside the frame.");
  });

  test("a paragraph the page rewrites goes back in the queue", async () => {
    document.body.innerHTML = `<p id="p">Loading results</p>`;
    const t = translator();
    const { doc } = t.start("translated", "zh-CN");
    t.apply(doc, zh(t.take(20, 3000)));
    const node = document.getElementById("p")!.firstChild as Text;
    expect(node.data).toBe("«Loading results»");

    node.data = "Found 3 results";
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(t.take(20, 3000)).toEqual([
      { id: expect.any(String), pieces: ["Found 3 results"], kinds: [""] },
    ]);
  });
});
