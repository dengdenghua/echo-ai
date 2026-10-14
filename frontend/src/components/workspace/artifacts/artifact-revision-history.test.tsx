import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactRevisionHistory } from "./artifact-revision-history";
import {
  listArtifactRevisions,
  readArtifactRevision,
} from "@/core/artifacts/revisions";
import {
  ArtifactSaveError,
  restoreWorkspaceOutputRevision,
} from "@/core/artifacts/save";

vi.mock("@/core/i18n/hooks", () => ({ useI18n: () => ({ locale: "zh-CN" }) }));
vi.mock("@/core/artifacts/revisions", () => ({
  listArtifactRevisions: vi.fn(),
  readArtifactRevision: vi.fn(),
}));
vi.mock("@/core/artifacts/save", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@/core/artifacts/save")),
  restoreWorkspaceOutputRevision: vi.fn(),
}));
vi.mock("@/components/workspace/diff-viewer", () => ({
  DiffViewer: ({
    oldValue,
    newValue,
    readOnly,
  }: {
    oldValue: string;
    newValue: string;
    readOnly: boolean;
  }) => (
    <div data-testid="comparison" data-read-only={String(readOnly)}>
      {oldValue} → {newValue}
    </div>
  ),
}));

const version = {
  revision_id: "1700000000000000000-abcdef123456.bak",
  created_at: 1700000000,
  bytes: 512,
};
const props = () => ({
  filepath: "workspace-output:final:site.html",
  threadId: "history",
  currentContent: "current",
  onRestored: vi.fn(),
  onBusyChange: vi.fn(),
});
const versionButton = () => screen.getByRole("button", { name: /KB/ });

describe("artifact revision history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listArtifactRevisions).mockResolvedValue({
      revisions: [version],
      next_cursor: null,
    });
    vi.mocked(readArtifactRevision).mockResolvedValue({
      revision_id: version.revision_id,
      content: "old",
      sha256: "digest",
    });
    vi.mocked(restoreWorkspaceOutputRevision).mockResolvedValue({
      success: true,
      path: "site.html",
      bytes: 3,
      sha256: "digest",
      revision_id: "redo",
    });
  });

  it("loads on demand, compares without writing, and allows keeping current", async () => {
    const user = userEvent.setup();
    render(<ArtifactRevisionHistory {...props()} />);
    expect(listArtifactRevisions).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "版本历史" }));
    await waitFor(() => expect(versionButton()).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "恢复此版本" })).toBeDisabled();
    await user.click(versionButton());
    expect(await screen.findByTestId("comparison")).toHaveTextContent(
      "current → old",
    );
    expect(screen.getByTestId("comparison")).toHaveAttribute(
      "data-read-only",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "保留当前版本" }));
    expect(restoreWorkspaceOutputRevision).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("restores explicitly once, protects closing during save, and updates the preview", async () => {
    const user = userEvent.setup();
    const values = props();
    let finish!: (
      value: Awaited<ReturnType<typeof restoreWorkspaceOutputRevision>>,
    ) => void;
    vi.mocked(restoreWorkspaceOutputRevision).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<ArtifactRevisionHistory {...values} />);
    await user.click(screen.getByRole("button", { name: "版本历史" }));
    await waitFor(() => expect(versionButton()).toBeInTheDocument());
    await user.click(versionButton());
    await screen.findByTestId("comparison");
    await user.dblClick(screen.getByRole("button", { name: "恢复此版本" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(restoreWorkspaceOutputRevision).toHaveBeenCalledTimes(1);
    expect(restoreWorkspaceOutputRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedContent: "current",
        revisionId: version.revision_id,
      }),
    );
    expect(values.onBusyChange).toHaveBeenCalledWith(true);
    await act(async () =>
      finish({ success: true, bytes: 3, path: "site.html", sha256: "digest" }),
    );
    expect(values.onRestored).toHaveBeenCalledWith("old");
    expect(values.onBusyChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("preserves current content on conflicts and disables stale restore", async () => {
    const user = userEvent.setup();
    const values = props();
    vi.mocked(restoreWorkspaceOutputRevision).mockRejectedValue(
      new ArtifactSaveError("changed", 409),
    );
    render(<ArtifactRevisionHistory {...values} />);
    await user.click(screen.getByRole("button", { name: "版本历史" }));
    await waitFor(() => expect(versionButton()).toBeInTheDocument());
    await user.click(versionButton());
    await screen.findByTestId("comparison");
    await user.click(screen.getByRole("button", { name: "恢复此版本" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "当前内容未覆盖",
    );
    expect(values.onRestored).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "恢复此版本" })).toBeDisabled();
  });

  it("does not retain stale selection or results when a different artifact opens", async () => {
    const user = userEvent.setup();
    let finish!: (
      value: Awaited<ReturnType<typeof readArtifactRevision>>,
    ) => void;
    vi.mocked(readArtifactRevision).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const values = props();
    const view = render(<ArtifactRevisionHistory {...values} />);
    await user.click(screen.getByRole("button", { name: "版本历史" }));
    await waitFor(() => expect(versionButton()).toBeInTheDocument());
    await user.click(versionButton());
    view.rerender(
      <ArtifactRevisionHistory
        {...values}
        filepath="workspace-output:final:other.html"
      />,
    );
    await act(async () =>
      finish({
        revision_id: version.revision_id,
        content: "stale other file",
        sha256: "digest",
      }),
    );
    expect(screen.queryByTestId("comparison")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复此版本" })).toBeDisabled();
  });

  it("loads earlier versions and clears old results on failed refresh", async () => {
    const user = userEvent.setup();
    vi.mocked(listArtifactRevisions)
      .mockResolvedValueOnce({ revisions: [version], next_cursor: "cursor" })
      .mockResolvedValueOnce({
        revisions: [{ ...version, revision_id: "older" }],
        next_cursor: null,
      })
      .mockRejectedValueOnce(new Error("offline"));
    render(<ArtifactRevisionHistory {...props()} />);
    await user.click(screen.getByRole("button", { name: "版本历史" }));
    await user.click(await screen.findByRole("button", { name: "更早版本" }));
    expect(listArtifactRevisions).toHaveBeenLastCalledWith(
      expect.objectContaining({ before: "cursor" }),
    );
    expect(screen.getAllByRole("button", { name: /KB/ })).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "保留当前版本" }));
    await user.click(screen.getByRole("button", { name: "版本历史" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("加载失败");
    expect(
      screen.queryByRole("button", { name: /KB/ }),
    ).not.toBeInTheDocument();
  });
});
