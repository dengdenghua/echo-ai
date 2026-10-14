import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import {
  SessionStatusPage,
  type SessionStatusPageProps,
} from "./session-status-page";

const artifactsState = vi.hoisted(() => ({ artifacts: [] as string[] }));

vi.mock("@/components/workspace/artifacts/context", () => ({
  useArtifacts: () => artifactsState,
}));

function renderPage(overrides: Partial<SessionStatusPageProps> = {}) {
  const props: SessionStatusPageProps = {
    workLocation: { kind: "local" },
    workDir: "E:/projects/demo-app",
    engine: "opencode",
    modelLabel: "GPT-5.5",
    contextTokens: 20_000,
    maxContextTokens: 100_000,
    contextSegments: [
      { label: "Messages", tokens: 12_000, color: "bg-primary" },
      { label: "System prompt", tokens: 8_000, color: "bg-warning" },
    ],
    isCompressingContext: false,
    onCompressContext: vi.fn(),
    onOpenArtifact: vi.fn(),
    ...overrides,
  };
  renderWithProviders(<SessionStatusPage {...props} />);
  return props;
}

describe("SessionStatusPage", () => {
  afterEach(() => {
    artifactsState.artifacts = [];
    vi.useRealTimers();
  });

  it("shows where the conversation runs and with what", () => {
    renderPage();
    const environment = screen.getByRole("region", { name: "Environment" });
    expect(environment).toHaveTextContent("Local");
    expect(environment).toHaveTextContent("E:/projects/demo-app");
    expect(environment).toHaveTextContent("OpenCode");
    expect(environment).toHaveTextContent("GPT-5.5");
  });

  it("names a remote location and an automatic model", () => {
    renderPage({
      workLocation: { kind: "remote", backend_id: "b1", transport: "wsl" },
      workDir: "",
      modelLabel: null,
    });
    const environment = screen.getByRole("region", { name: "Environment" });
    expect(environment).toHaveTextContent("WSL");
    expect(environment).toHaveTextContent("Personal space");
    expect(environment).toHaveTextContent("Auto");
  });

  it("breaks the context down and compresses on demand", () => {
    const props = renderPage();
    const context = screen.getByRole("region", { name: "Context" });
    expect(context).toHaveTextContent("20K / 100K (20%)");
    expect(context).toHaveTextContent("System prompt");
    expect(context).toHaveTextContent("Free space");
    expect(context).not.toHaveTextContent("auto-compact");
    fireEvent.click(screen.getByTestId("session-status-compress"));
    expect(props.onCompressContext).toHaveBeenCalledTimes(1);
  });

  it("warns near the auto-compaction trigger", () => {
    renderPage({ contextTokens: 80_000, contextSegments: [] });
    expect(screen.getByRole("region", { name: "Context" })).toHaveTextContent(
      "older turns auto-compact at about 90%",
    );
  });

  it("shows compression progress in place of the button label", () => {
    vi.useFakeTimers();
    renderPage({ isCompressingContext: true });
    const button = screen.getByTestId("session-status-compress");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Compressing… 0s");
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(button).toHaveTextContent("Compressing… 3s");
  });

  it("lists produced files and opens the one clicked", () => {
    artifactsState.artifacts = [
      "/mnt/user-data/outputs/report.md",
      "/mnt/user-data/outputs/chart.png",
    ];
    const props = renderPage();
    const outputs = screen.getByRole("region", { name: "Outputs" });
    expect(outputs).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: /chart\.png/ }));
    expect(props.onOpenArtifact).toHaveBeenCalledWith(
      "/mnt/user-data/outputs/chart.png",
    );
  });

  it("says so when nothing has been produced", () => {
    renderPage();
    expect(screen.getByRole("region", { name: "Outputs" })).toHaveTextContent(
      "No files produced in this conversation yet.",
    );
  });

  it("speaks Chinese for zh-CN users", () => {
    renderWithProviders(
      <SessionStatusPage
        workLocation={{ kind: "local" }}
        workDir=""
        engine="echo"
        modelLabel={null}
        contextTokens={0}
        maxContextTokens={100_000}
        contextSegments={[]}
        isCompressingContext={false}
        onCompressContext={vi.fn()}
      />,
      { locale: "zh-CN" },
    );
    expect(screen.getByRole("region", { name: "环境" })).toHaveTextContent(
      "本地",
    );
    expect(screen.getByRole("button", { name: /压缩上下文/ })).toBeDisabled();
  });
});
