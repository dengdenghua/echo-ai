// An engine whose favicon cannot load falls back to its letters in ink on a
// neutral tile, as on the phone: engines are told apart by name, not brand
// colour (ECHO colour only carries state).
const NEUTRAL_GLYPH = "bg-foreground/10 text-foreground";

export const SEARCH_ENGINES = [
  {
    name: "Baidu",
    url: "https://www.baidu.com/s?wd=",
    icon: "Bai",
    logoUrl: "https://www.baidu.com/favicon.ico",
    accent: NEUTRAL_GLYPH,
  },
  {
    name: "Google",
    url: "https://www.google.com/search?q=",
    icon: "G",
    logoUrl: "https://www.google.com/favicon.ico",
    accent: NEUTRAL_GLYPH,
  },
  {
    name: "Bing",
    url: "https://www.bing.com/search?q=",
    icon: "B",
    logoUrl: "https://www.bing.com/favicon.ico",
    accent: NEUTRAL_GLYPH,
  },
  {
    name: "GitHub",
    url: "https://github.com/search?q=",
    icon: "GH",
    logoUrl: "https://github.githubassets.com/favicons/favicon.svg",
    accent: NEUTRAL_GLYPH,
  },
];

export type SearchEngine = (typeof SEARCH_ENGINES)[number];

const PREFERRED_ENGINE_KEY = "echo.browser.search-engine.v1";

/**
 * The engine chosen on the start page, shared with the address bar so the
 * browser has one search engine. GitHub search falls back to Bing there.
 */
export function preferredSearchEngine(): SearchEngine {
  let saved = "";
  try {
    saved = localStorage.getItem(PREFERRED_ENGINE_KEY) ?? "";
  } catch {
    /* storage unavailable: use the default */
  }
  const engine =
    SEARCH_ENGINES.find((item) => item.name === saved) ?? SEARCH_ENGINES[0]!;
  return engine.name === "GitHub"
    ? SEARCH_ENGINES.find((item) => item.name === "Bing")!
    : engine;
}

/** Engine id for /api/browser/suggest. */
export function suggestEngineId(engine: SearchEngine): string {
  return engine.name.toLowerCase();
}
