import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SquarePage from "@/app/workspace/community/page";
import { squareCopy } from "@/core/i18n/locales/square";
import { renderWithProviders } from "@/test/harness";

import {
  readCachedFeed,
  readLocalDrafts,
  relativeTime,
  removeLocalDraft,
  writeCachedFeed,
} from "./square-data";
import { SquareInspiration } from "./square-inspiration";
import { SquareMarket } from "./square-market";
import type { SquareMarketItem, SquarePost } from "./square-types";

const host = vi.hoisted(() => ({
  fetchSquareFeed: vi.fn(),
  fetchSquareComments: vi.fn(),
  fetchSquareUser: vi.fn(),
  fetchSquareMarket: vi.fn(),
}));

vi.mock("./square-host", () => ({
  ...host,
  SquareProgressLine: () => <span data-testid="progress-line" />,
}));

const zh = squareCopy("zh-CN");

function post(overrides: Partial<SquarePost> = {}): SquarePost {
  return {
    id: "p1",
    kind: "post",
    title: "官方教程 · 新手上手指南",
    content: "5 分钟从零开始",
    cover_url: "",
    images: [],
    tag: "教程",
    topic: "recommend",
    author: "ECHO 官方",
    author_id: "abc123",
    author_initial: "E",
    likes_count: 3,
    comments_count: 0,
    favorites_count: 0,
    views_count: 12,
    app_ref: "",
    app_kind: "",
    price_credits: 0,
    sub_price_credits: 0,
    forked_from: "",
    created_at: Date.now() - 3_600_000,
    ...overrides,
  };
}

function marketItem(
  overrides: Partial<SquareMarketItem> = {},
): SquareMarketItem {
  return {
    id: "skill/pdf",
    slug: "pdf",
    name: "pdf",
    description: "Read and fill PDF forms",
    category: "",
    version: "1",
    downloads: 0,
    platforms: ["mobile", "desktop"],
    author: "echo",
    license: "",
    ...overrides,
  };
}

function renderInspiration(query = "") {
  return renderWithProviders(
    <SquareInspiration
      copy={zh}
      locale="zh-CN"
      query={query}
      reloadKey={0}
      onOpenPost={vi.fn()}
      onOpenAuthor={vi.fn()}
    />,
    { locale: "zh-CN" },
  );
}

beforeEach(() => {
  window.localStorage.clear();
  host.fetchSquareFeed.mockReset();
  host.fetchSquareComments.mockReset();
  host.fetchSquareUser.mockReset();
  host.fetchSquareMarket.mockReset();
});

describe("square data", () => {
  it("keeps the last synced feed per topic and sort", () => {
    expect(readCachedFeed("recommend", "latest")).toBeNull();
    writeCachedFeed("recommend", "latest", { posts: [post()], has_more: true });
    expect(readCachedFeed("recommend", "latest")?.posts).toHaveLength(1);
    expect(readCachedFeed("recommend", "hot")).toBeNull();
    writeCachedFeed("life", "latest", { posts: [], has_more: false });
    expect(readCachedFeed("life", "latest")).toBeNull();
  });

  it("reads drafts an older build kept locally and drops malformed ones", () => {
    window.localStorage.setItem(
      "echo.community.published.v1",
      JSON.stringify([
        { id: "p.1", title: "我的灵感", content: "正文", createdAt: 5 },
        { id: "p.2" },
        "junk",
      ]),
    );
    expect(readLocalDrafts().map((draft) => draft.id)).toEqual(["p.1"]);
    expect(removeLocalDraft("p.1")).toEqual([]);
    expect(
      window.localStorage.getItem("echo.community.published.v1"),
    ).toBeNull();
  });

  it("formats relative time in the viewer's language", () => {
    const now = Date.UTC(2026, 9, 15, 12);
    expect(relativeTime(now - 2 * 3_600_000, "en-US", now)).toBe("2 hours ago");
    expect(relativeTime(0, "en-US", now)).toBe("");
  });
});

describe("SquareInspiration", () => {
  it("shows exactly what the Square returns", async () => {
    host.fetchSquareFeed.mockResolvedValue({
      posts: [post()],
      has_more: false,
    });
    renderInspiration();

    expect(
      await screen.findByText("官方教程 · 新手上手指南"),
    ).toBeInTheDocument();
    expect(screen.getByText("ECHO 官方")).toBeInTheDocument();
    expect(host.fetchSquareFeed).toHaveBeenCalledWith(
      { topic: "recommend", sort: "latest", q: "", offset: 0, limit: 20 },
      expect.any(AbortSignal),
    );
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("says it cannot reach the Square, and retries, instead of inventing posts", async () => {
    host.fetchSquareFeed.mockRejectedValueOnce(new Error("502"));
    host.fetchSquareFeed.mockResolvedValueOnce({
      posts: [post()],
      has_more: false,
    });
    const user = userEvent.setup();
    renderInspiration();

    expect(await screen.findByText("暂时连不上广场")).toBeInTheDocument();
    expect(screen.queryByRole("article")).toBeNull();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(
      await screen.findByText("官方教程 · 新手上手指南"),
    ).toBeInTheDocument();
    expect(host.fetchSquareFeed).toHaveBeenCalledTimes(2);
  });

  it("labels the last synced feed as such when offline", async () => {
    writeCachedFeed("recommend", "latest", {
      posts: [post()],
      has_more: false,
    });
    host.fetchSquareFeed.mockRejectedValue(new Error("502"));
    renderInspiration();

    expect(await screen.findByText(zh.staleNotice)).toBeInTheDocument();
    expect(screen.getByText("官方教程 · 新手上手指南")).toBeInTheDocument();
  });

  it("switches sort and topic through the Square, and says when it is empty", async () => {
    host.fetchSquareFeed.mockResolvedValue({ posts: [], has_more: false });
    const user = userEvent.setup();
    renderInspiration();

    expect(await screen.findByText("这里还没有内容。")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "热门" }));
    await user.click(screen.getByRole("button", { name: "生活" }));
    await waitFor(() =>
      expect(host.fetchSquareFeed).toHaveBeenLastCalledWith(
        { topic: "life", sort: "hot", q: "", offset: 0, limit: 20 },
        expect.any(AbortSignal),
      ),
    );
    expect(screen.getByText("热门 · 生活")).toBeInTheDocument();
  });

  it("shows local drafts as never published", async () => {
    window.localStorage.setItem(
      "echo.community.published.v1",
      JSON.stringify([{ id: "p.1", title: "我的灵感", createdAt: 5 }]),
    );
    host.fetchSquareFeed.mockResolvedValue({ posts: [], has_more: false });
    renderInspiration();

    expect(await screen.findByText("本机草稿 1")).toBeInTheDocument();
    expect(screen.getByText(zh.drafts.note)).toBeInTheDocument();
  });
});

describe("SquareMarket", () => {
  it("lists desktop-ready skills and opens HUB for them", async () => {
    host.fetchSquareMarket.mockResolvedValue({
      kind: "skill",
      items: [
        marketItem(),
        marketItem({
          id: "skill/phone",
          name: "phone-only",
          platforms: ["mobile"],
        }),
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(
      <SquareMarket copy={zh} locale="zh-CN" reloadKey={0} />,
      {
        locale: "zh-CN",
      },
    );

    expect(await screen.findByText("pdf")).toBeInTheDocument();
    expect(screen.queryByText("phone-only")).toBeNull();
    expect(screen.queryByRole("button", { name: "排行" })).toBeNull();
    await user.click(screen.getByText("pdf"));
    expect(
      await screen.findByRole("button", { name: "在 HUB 中查看技能" }),
    ).toBeInTheDocument();
  });

  it("sorts phone apps on the Square and says how to install them", async () => {
    host.fetchSquareMarket.mockImplementation((kind: string) =>
      Promise.resolve({
        kind,
        items:
          kind === "app"
            ? [
                marketItem({
                  id: "plugin/seed-ledger",
                  name: "极简记账本",
                  category: "理财",
                  downloads: 61,
                  platforms: ["mobile"],
                }),
              ]
            : [],
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <SquareMarket copy={zh} locale="zh-CN" reloadKey={0} />,
      {
        locale: "zh-CN",
      },
    );

    await user.click(await screen.findByRole("tab", { name: "应用" }));
    expect(await screen.findByText("极简记账本")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "排行" }));
    await waitFor(() =>
      expect(host.fetchSquareMarket).toHaveBeenLastCalledWith(
        "app",
        "downloads",
        expect.any(AbortSignal),
      ),
    );
    await user.click(await screen.findByText("极简记账本"));
    expect(
      await screen.findByText(zh.market.phoneInstallNote),
    ).toBeInTheDocument();
  });

  it("shows a load failure with retry", async () => {
    host.fetchSquareMarket.mockRejectedValue(new Error("502"));
    renderWithProviders(
      <SquareMarket copy={zh} locale="zh-CN" reloadKey={0} />,
      {
        locale: "zh-CN",
      },
    );
    expect(await screen.findByText("列表加载失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

describe("SquarePage", () => {
  it("is called 广场 and switches between 灵感 and 市场", async () => {
    host.fetchSquareFeed.mockResolvedValue({
      posts: [post()],
      has_more: false,
    });
    host.fetchSquareMarket.mockResolvedValue({ kind: "skill", items: [] });
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <SquarePage />
        <LocationProbe />
      </>,
      { locale: "zh-CN", initialRoute: "/workspace/community" },
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "广场" }),
    ).toBeInTheDocument();
    const tabs = screen.getByRole("tablist", { name: "广场" });
    expect(within(tabs).getByRole("tab", { name: "灵感" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(within(tabs).getByRole("tab", { name: "市场" }));
    expect(screen.getByTestId("location")).toHaveTextContent("?view=market");
    expect(await screen.findByText(zh.market.empty)).toBeInTheDocument();
  });

  it("opens a post read-only, with its comments", async () => {
    host.fetchSquareFeed.mockResolvedValue({
      posts: [post({ comments_count: 1 })],
      has_more: false,
    });
    host.fetchSquareComments.mockResolvedValue({
      comments: [
        {
          id: "c1",
          author: "小满",
          author_id: "u1",
          content: "收藏了",
          parent_id: "",
          created_at: Date.now(),
        },
      ],
      has_more: false,
    });
    const user = userEvent.setup();
    renderWithProviders(<SquarePage />, {
      locale: "zh-CN",
      initialRoute: "/workspace/community",
    });

    await user.click(await screen.findByText("官方教程 · 新手上手指南"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("帖子详情")).toBeInTheDocument();
    expect(await within(dialog).findByText("收藏了")).toBeInTheDocument();
    expect(within(dialog).getByText(zh.detail.accountNote)).toBeInTheDocument();
    expect(host.fetchSquareComments).toHaveBeenCalledWith(
      "p1",
      expect.any(AbortSignal),
    );
  });
});
