import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactProposalReview } from "./artifact-proposal-review";
import {
  decideArtifactProposal,
  listArtifactProposals,
  readArtifactProposal,
} from "@/core/artifacts/proposals";

vi.mock("@/core/i18n/hooks", () => ({ useI18n: () => ({ locale: "zh-CN" }) }));
vi.mock("@/core/artifacts/proposals", () => ({
  decideArtifactProposal: vi.fn(),
  listArtifactProposals: vi.fn(),
  readArtifactProposal: vi.fn(),
}));
vi.mock("@/components/workspace/diff-viewer", () => ({
  DiffViewer: ({
    oldValue,
    newValue,
  }: {
    oldValue: string;
    newValue: string;
  }) => (
    <p data-testid="diff">
      {oldValue} → {newValue}
    </p>
  ),
}));
const pending = {
  proposal_id: "proposal",
  status: "pending" as const,
  created_at: 1700000000,
  base_sha256: "base",
};
const detail = {
  ...pending,
  base_content: "Original",
  candidate_content: "Proposed",
  candidate_sha256: "reviewed",
  changed: true,
  conflict: false,
};
const props = () => ({
  filepath: "workspace-output:final:site.html",
  threadId: "thread",
  running: false,
  refreshKey: 0,
  onApplied: vi.fn(),
  onBusyChange: vi.fn(),
  onReload: vi.fn(),
});
async function openReview() {
  await userEvent.click(
    await screen.findByRole("button", { name: "待审修改 1" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: /待审.*2023/ }),
  );
  await screen.findByTestId("diff");
}

describe("artifact proposals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listArtifactProposals).mockResolvedValue({
      proposals: [pending],
    });
    vi.mocked(readArtifactProposal).mockResolvedValue(detail);
    vi.mocked(decideArtifactProposal).mockResolvedValue({
      ...pending,
      status: "accepted",
      current_sha256: "reviewed",
    });
  });
  it("only applies after explicit acceptance of the compared hash", async () => {
    const values = props();
    render(<ArtifactProposalReview {...values} />);
    await openReview();
    expect(screen.getByTestId("diff")).toHaveTextContent("Original → Proposed");
    expect(decideArtifactProposal).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "接受修改" }));
    expect(decideArtifactProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "accept",
        proposalId: "proposal",
        reviewedSha256: "reviewed",
      }),
    );
    expect(values.onApplied).toHaveBeenCalledWith("Proposed");
  });
  it("rejects without changing the displayed official artifact", async () => {
    vi.mocked(decideArtifactProposal).mockResolvedValue({
      ...pending,
      status: "rejected",
    });
    const values = props();
    render(<ArtifactProposalReview {...values} />);
    await openReview();
    await userEvent.click(screen.getByRole("button", { name: "拒绝修改" }));
    expect(decideArtifactProposal).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reject" }),
    );
    expect(values.onApplied).not.toHaveBeenCalled();
  });
  it("reloads the official file if a retried acceptance has since been undone", async () => {
    vi.mocked(decideArtifactProposal).mockResolvedValue({
      ...pending,
      status: "accepted",
      current_sha256: "restored-original",
    });
    const values = props();
    render(<ArtifactProposalReview {...values} />);
    await openReview();
    await userEvent.click(screen.getByRole("button", { name: "接受修改" }));
    expect(values.onApplied).not.toHaveBeenCalled();
    expect(values.onReload).toHaveBeenCalledTimes(1);
  });
  it.each(["running", "unchanged", "conflict"])(
    "does not accept %s work",
    async (condition) => {
      const values = props();
      if (condition === "running") values.running = true;
      vi.mocked(readArtifactProposal).mockResolvedValue({
        ...detail,
        changed: condition !== "unchanged",
        conflict: condition === "conflict",
      });
      render(<ArtifactProposalReview {...values} />);
      await openReview();
      expect(screen.getByRole("button", { name: "接受修改" })).toBeDisabled();
      expect(values.onApplied).not.toHaveBeenCalled();
    },
  );
  it("clears an outdated comparison when acceptance fails", async () => {
    vi.mocked(decideArtifactProposal).mockRejectedValue(
      new Error("工作副本已变化"),
    );
    const values = props();
    render(<ArtifactProposalReview {...values} />);
    await openReview();
    await userEvent.click(screen.getByRole("button", { name: "接受修改" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "工作副本已变化",
    );
    expect(screen.getByRole("button", { name: "接受修改" })).toBeDisabled();
    expect(values.onApplied).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "重新比较" }));
    await waitFor(() => expect(readArtifactProposal).toHaveBeenCalledTimes(2));
  });
  it("coalesces double clicks and keeps the dialog open while applying", async () => {
    let resolve!: (
      value: Awaited<ReturnType<typeof decideArtifactProposal>>,
    ) => void;
    vi.mocked(decideArtifactProposal).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const values = props();
    render(<ArtifactProposalReview {...values} />);
    await openReview();
    await userEvent.dblClick(screen.getByRole("button", { name: "接受修改" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(decideArtifactProposal).toHaveBeenCalledTimes(1);
    expect(values.onBusyChange).toHaveBeenCalledWith(true);
    await act(async () =>
      resolve({ ...pending, status: "accepted", current_sha256: "reviewed" }),
    );
    expect(values.onBusyChange).toHaveBeenLastCalledWith(false);
  });
});
