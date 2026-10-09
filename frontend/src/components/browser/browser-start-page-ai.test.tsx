import { createRef, useState } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { BROWSER_ACTION_PROTOCOL, visibleUserText } from "./agentic-actions";
import {
  BrowserStartPage,
  topSitesFromHistory,
  type StartSite,
} from "./browser-start-page";

vi.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ isAuthenticated: true, user: { username: "local" } }),
}));
const onOpen = vi.fn();
const onSearch = vi.fn();
const onAsk = vi.fn();

function Home({ topSites = [] }: { topSites?: StartSite[] }) {
  const [query, setQuery] = useState("");
  return (
    <BrowserStartPage
      active
      query={query}
      onQueryChange={setQuery}
      onSearch={() => onSearch(query)}
      searchInputRef={createRef<HTMLInputElement>()}
      engines={[{ name: "Bing" }]}
      selectedEngine={0}
      onEngineChange={() => {}}
      onOpen={onOpen}
      onManageDesktop={() => {}}
      apps={[]}
      onAsk={onAsk}
      topSites={topSites}
    />
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

const box = () =>
  screen.getByRole("combobox", { name: "问 AI，或搜索、输入网址" });

describe("AI start page", () => {
  it("asks the AI on Enter and clears the box", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Home />);
    await user.type(box(), "今天的科技新闻{Enter}");
    expect(onAsk).toHaveBeenCalledWith("今天的科技新闻");
    expect(onSearch).not.toHaveBeenCalled();
    expect(box()).toHaveValue("");
  });

  it("opens an address directly and keeps search one arrow away", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Home />);
    await user.type(box(), "example.com");
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual([
      expect.stringContaining("打开网址"),
      expect.stringContaining("问 AI"),
      expect.stringContaining("用 Bing 搜索"),
    ]);
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith("https://example.com");

    await user.clear(box());
    await user.type(box(), "星空{ArrowDown}{Enter}");
    expect(onSearch).toHaveBeenCalledWith("星空");
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("fills the box from a prompt and shows frequent sites", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Home topSites={[{ url: "https://github.com/", title: "github.com" }]} />,
    );
    await user.click(
      screen.getByRole("button", { name: /本周最热门的 AI 开源项目/ }),
    );
    expect(box()).toHaveValue("打开 GitHub，找本周最热门的 AI 开源项目");
    expect(
      screen.queryByRole("navigation", { name: "常去网站" }),
    ).not.toBeInTheDocument();

    await user.clear(box());
    await user.click(screen.getByRole("button", { name: /github\.com/ }));
    expect(onOpen).toHaveBeenCalledWith("https://github.com/");
  });
});

describe("topSitesFromHistory", () => {
  it("ranks hosts by visits, then recency, one tile per host", () => {
    expect(
      topSitesFromHistory([
        { url: "https://www.github.com/a", visitedAt: 1 },
        { url: "https://github.com/b", visitedAt: 5 },
        { url: "https://news.ycombinator.com/", visitedAt: 9 },
        { url: "echo://home", visitedAt: 10 },
        { url: "https://example.com/", visitedAt: 3 },
      ]),
    ).toEqual([
      {
        url: "https://www.github.com/",
        title: "github.com",
        favicon: undefined,
      },
      {
        url: "https://news.ycombinator.com/",
        title: "news.ycombinator.com",
        favicon: undefined,
      },
      { url: "https://example.com/", title: "example.com", favicon: undefined },
    ]);
  });
});

describe("visibleUserText", () => {
  it("hides the protocol the model receives in front of the request", () => {
    expect(
      visibleUserText(`${BROWSER_ACTION_PROTOCOL}\n\n---\n\n总结这个页面`),
    ).toBe("总结这个页面");
    expect(visibleUserText("a --- b\n---\nc")).toBe("a --- b\n---\nc");
  });
});
