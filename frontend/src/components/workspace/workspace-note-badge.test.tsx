import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { WorkspaceNoteBadge } from "./workspace-note-badge";
import type { LiveToolEvent } from "./live-tool-timeline";
import { renderWithProviders } from "@/test/harness";

interface SummaryPayload {
  branch: string;
  detached?: boolean;
  worktree?: boolean;
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  changed_files: number;
  untracked_files?: number;
  added: number;
  removed: number;
  error?: string | null;
  diff_error?: string | null;
}

function stubSummary(payload: SummaryPayload) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function event(partial: Partial<LiveToolEvent>): LiveToolEvent {
  return {
    id: "event-1",
    name: "read_file",
    status: "done",
    startedAt: 1_000,
    iteration: 0,
    ...partial,
  };
}

function planEvents(): LiveToolEvent[] {
  return [
    event({
      id: "todo-1",
      name: "todo_write",
      status: "running",
      input: {
        items: [
          { content: "盘点全部 429 处改动", status: "completed" },
          { content: "按逻辑分组提交", status: "in_progress" },
        ],
      },
    }),
  ];
}

// The note persists its expanded state in localStorage, so a test that
// expands the card would otherwise leave every later test starting expanded
// instead of collapsed.
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("<WorkspaceNoteBadge />", () => {
  test("stays out of the way when there is nothing to report", async () => {
    stubSummary({ branch: "", changed_files: 0, added: 0, removed: 0 });

    const { container } = renderWithProviders(
      <WorkspaceNoteBadge workDir="D:/echo-ai" events={[]} />,
      { locale: "zh-CN" },
    );

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(
      screen.queryByRole("button", { name: "概要便签" }),
    ).not.toBeInTheDocument();
  });

  test("collapses the sidebar summary into one always-visible line", async () => {
    stubSummary({
      branch: "codex/message-actions-quotes",
      changed_files: 2,
      added: 46,
      removed: 25,
    });

    renderWithProviders(
      <WorkspaceNoteBadge
        workDir="D:/echo-ai"
        events={planEvents()}
        runSettled={false}
      />,
      { locale: "zh-CN" },
    );

    const badge = await screen.findByRole("button", { name: "概要便签" });
    expect(badge).toHaveAttribute("aria-expanded", "false");
    expect(await screen.findByText("codex/message-actions-quotes")).toBeVisible();
    expect(screen.getByText("+46")).toBeVisible();
    expect(screen.getByText("-25")).toBeVisible();
    expect(screen.getByText("2 个文件")).toBeVisible();
    expect(screen.getByText("2/2")).toBeVisible();

    // Collapsed means collapsed: no sidebar detail leaks onto the page.
    expect(screen.queryByText("环境信息")).not.toBeInTheDocument();
  });

  test("shows a localized detached head instead of git's own wording", async () => {
    stubSummary({
      branch: "",
      detached: true,
      changed_files: 1,
      added: 3,
      removed: 0,
    });

    renderWithProviders(
      <WorkspaceNoteBadge workDir="D:/echo-ai" events={[]} />,
      { locale: "zh-CN" },
    );

    // git says "HEAD (no branch)"; the UI must say "游离 HEAD".
    expect(await screen.findByText("游离 HEAD")).toBeVisible();
    expect(screen.queryByText("HEAD (no branch)")).toBeNull();
  });

  test("stays out of the way for a directory that is not a repository", async () => {
    stubSummary({
      branch: "",
      detached: false,
      changed_files: 0,
      added: 0,
      removed: 0,
      error: "not a git repository",
    });

    const { container } = renderWithProviders(
      <WorkspaceNoteBadge workDir="D:/echo-ai" events={[]} />,
      { locale: "zh-CN" },
    );

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  test("does not claim a detached head for a directory that is not a repo", async () => {
    stubSummary({
      branch: "",
      detached: false,
      changed_files: 0,
      added: 0,
      removed: 0,
      error: "not a git repository",
    });

    renderWithProviders(
      // A live run keeps the badge on screen even without a repository, which
      // is the only way the branch row gets a chance to lie about why it is
      // empty.
      <WorkspaceNoteBadge
        workDir="D:/echo-ai"
        events={planEvents()}
        runSettled={false}
      />,
      { locale: "zh-CN" },
    );

    fireEvent.click(await screen.findByRole("button", { name: "概要便签" }));

    // No branch to report is not the same as a detached HEAD.
    await waitFor(() =>
      expect(document.querySelector('[data-note-branch-label="none"]')).toBeTruthy(),
    );
    expect(screen.queryByText("游离 HEAD")).toBeNull();
  });

  test("expands into environment and process sections", async () => {
    stubSummary({
      branch: "codex/message-actions-quotes",
      upstream: "origin/codex/message-actions-quotes",
      ahead: 9,
      behind: 2,
      changed_files: 2,
      added: 46,
      removed: 25,
    });

    renderWithProviders(
      <WorkspaceNoteBadge workDir="D:/echo-ai" events={planEvents()} />,
      { locale: "zh-CN" },
    );

    fireEvent.click(await screen.findByRole("button", { name: "概要便签" }));

    expect(await screen.findByText("环境信息")).toBeVisible();
    expect(screen.getByText("变更")).toBeVisible();
    expect(screen.getByText("分支")).toBeVisible();
    expect(screen.getByText("领先 9 / 落后 2")).toBeVisible();
    expect(screen.getByText("进程")).toBeVisible();
    expect(screen.getByText("盘点全部 429 处改动")).toBeVisible();
    expect(screen.getByText("按逻辑分组提交")).toBeVisible();
  });

  test("says plainly that pull request status is unavailable", async () => {
    stubSummary({
      branch: "main",
      changed_files: 1,
      added: 3,
      removed: 0,
    });

    renderWithProviders(
      <WorkspaceNoteBadge workDir="D:/echo-ai" events={[]} />,
      { locale: "zh-CN" },
    );

    fireEvent.click(await screen.findByRole("button", { name: "概要便签" }));

    const row = await screen.findByText("无法获取 Pull Request 状态");
    expect(row).toBeVisible();
    // The row must not pretend a stale status is live data.
    expect(
      document.querySelector('[data-note-pr="unavailable"]'),
    ).toBeTruthy();
  });

  test("a failed first read does not masquerade as a clean tree", async () => {
    // fetch rejects before any summary lands: there is no "last reading" to
    // show, so the card must not claim the tree is clean.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connection refused")),
    );

    renderWithProviders(
      <WorkspaceNoteBadge workDir="D:/echo-ai" events={planEvents()} />,
      { locale: "zh-CN" },
    );

    fireEvent.click(await screen.findByRole("button", { name: "概要便签" }));

    expect(
      await screen.findByText("读取工作区状态失败，请刷新重试。"),
    ).toBeVisible();
    expect(screen.queryByText("无未提交变更")).toBeNull();
    expect(screen.queryByText("读取工作区状态失败，显示的是上次结果。")).toBeNull();
  });

  test("flags that line totals skip untracked files", async () => {
    // The shape the endpoint actually returns for a brand-new untracked file:
    // git diff succeeds, prints nothing, and the file count is non-zero.
    stubSummary({
      branch: "main",
      changed_files: 1,
      untracked_files: 1,
      added: 0,
      removed: 0,
    });

    renderWithProviders(
      <WorkspaceNoteBadge workDir="D:/echo-ai" events={[]} />,
      { locale: "zh-CN" },
    );

    fireEvent.click(await screen.findByRole("button", { name: "概要便签" }));

    expect(await screen.findByText("行数只统计已跟踪文件。")).toBeVisible();
  });

  test("blames the diff, not untracked files, when diffing itself fails", async () => {
    stubSummary({
      branch: "main",
      changed_files: 2,
      untracked_files: 0,
      added: 0,
      removed: 0,
      diff_error: "git diff failed",
    });

    renderWithProviders(
      <WorkspaceNoteBadge workDir="D:/echo-ai" events={[]} />,
      { locale: "zh-CN" },
    );

    fireEvent.click(await screen.findByRole("button", { name: "概要便签" }));

    expect(await screen.findByText("差异比对失败，无法统计行数。")).toBeVisible();
    expect(screen.queryByText("行数只统计已跟踪文件。")).toBeNull();
  });

  test("escapes back to the one-line badge", async () => {
    stubSummary({ branch: "main", changed_files: 1, added: 1, removed: 0 });

    renderWithProviders(
      <WorkspaceNoteBadge workDir="D:/echo-ai" events={[]} />,
      { locale: "zh-CN" },
    );

    fireEvent.click(await screen.findByRole("button", { name: "概要便签" }));
    expect(await screen.findByText("环境信息")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByText("环境信息")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "概要便签" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("does not query git without a workspace", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = renderWithProviders(
      <WorkspaceNoteBadge workDir={null} events={planEvents()} />,
      { locale: "zh-CN" },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    // The run checklist still has something to say.
    expect(container).not.toBeEmptyDOMElement();
  });

  test("renders Codex-style floating card with defaultExpanded and persistence", async () => {
    window.localStorage.clear();
    stubSummary({
      branch: "codex/message-actions-quotes",
      changed_files: 2,
      added: 1606,
      removed: 258,
    });

    const onOpenWorkbench = vi.fn();

    renderWithProviders(
      <WorkspaceNoteBadge
        workDir="D:/echo-ai"
        events={planEvents()}
        defaultExpanded={true}
        onOpenWorkbench={onOpenWorkbench}
      />,
      { locale: "zh-CN" },
    );

    // Directly expanded without needing to click first
    expect(await screen.findByText("Git 工具")).toBeVisible();
    expect(screen.getByText("更改")).toBeVisible();
    expect(screen.getByText("+1,606")).toBeVisible();
    expect(screen.getByText("-258")).toBeVisible();
    expect(screen.getByText("codex/message-actions-quotes")).toBeVisible();
    expect(screen.getByText("提交或推送")).toBeVisible();
    expect(screen.getByText("进程")).toBeVisible();

    // Clicking commit or push invokes workbench
    fireEvent.click(screen.getByText("提交或推送"));
    expect(onOpenWorkbench).toHaveBeenCalledTimes(1);

    // Clicking outside does NOT close the persistent card
    fireEvent.pointerDown(document.body);
    expect(screen.getByText("Git 工具")).toBeVisible();

    // Clicking collapse button (ChevronUp) collapses it into the pill
    fireEvent.click(screen.getByRole("button", { name: "收起便签" }));
    await waitFor(() => {
      expect(screen.queryByText("Git 工具")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "概要便签" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("marks a local checkout and stays quiet about detached HEAD", async () => {
    window.localStorage.clear();
    stubSummary({ branch: "main", changed_files: 0, added: 0, removed: 0 });

    renderWithProviders(
      <WorkspaceNoteBadge workDir="D:/echo-ai" events={[]} defaultExpanded={true} />,
      { locale: "zh-CN" },
    );

    expect(await screen.findByText("本地")).toBeVisible();
    expect(document.querySelector('[data-note-env="local"]')).not.toBeNull();
    expect(document.querySelector('[data-note-detached-hint="true"]')).toBeNull();
  });

  test("labels a linked worktree and explains a detached HEAD", async () => {
    window.localStorage.clear();
    stubSummary({
      branch: "",
      detached: true,
      worktree: true,
      changed_files: 1,
      added: 3,
      removed: 1,
    });

    renderWithProviders(
      <WorkspaceNoteBadge workDir="D:/echo-ai" events={[]} defaultExpanded={true} />,
      { locale: "zh-CN" },
    );

    expect(await screen.findByText("Worktree")).toBeVisible();
    expect(document.querySelector('[data-note-env="worktree"]')).not.toBeNull();
    expect(document.querySelector('[data-note-detached-hint="true"]')).not.toBeNull();
  });

  test("remembers the expanded state across mounts", async () => {
    window.localStorage.clear();
    stubSummary({ branch: "main", changed_files: 0, added: 0, removed: 0 });

    const first = renderWithProviders(
      <WorkspaceNoteBadge workDir="D:/echo-ai" events={[]} defaultExpanded={true} />,
      { locale: "zh-CN" },
    );
    expect(await screen.findByText("Git 工具")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "收起便签" }));
    await waitFor(() => {
      expect(screen.queryByText("Git 工具")).not.toBeInTheDocument();
    });
    first.unmount();

    // The persisted choice wins over defaultExpanded on the next mount.
    renderWithProviders(
      <WorkspaceNoteBadge workDir="D:/echo-ai" events={[]} defaultExpanded={true} />,
      { locale: "zh-CN" },
    );
    // The summary fetch resolves asynchronously, so wait for the pill
    // before asserting the card stayed collapsed.
    expect(
      await screen.findByRole("button", { name: "概要便签" }),
    ).toBeVisible();
    expect(screen.queryByText("Git 工具")).not.toBeInTheDocument();
  });
});
