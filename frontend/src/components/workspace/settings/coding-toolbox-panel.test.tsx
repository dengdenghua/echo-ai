import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { CodingToolboxPanel } from "./coding-toolbox-panel";

vi.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({
    authStatus: { enabled: false },
    isAuthenticated: false,
    isLoading: false,
  }),
}));

const repository = {
  root: "/project",
  branches: ["main"],
  worktrees: [
    {
      path: "/project",
      branch: "main",
      commit: "a".repeat(40),
      current: true,
      locked: false,
    },
  ],
};

describe("live coding toolbox", () => {
  beforeEach(() => {
    localStorage.setItem("echo:recentWorkdirs", JSON.stringify(["/project"]));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url) => {
        const path = String(url);
        if (path.includes("/api/health"))
          return Response.json({
            status: "ok",
            runtime: { version: "0.1.0", hostApiVersion: "0.2.0" },
          });
        if (path.includes("/api/permissions"))
          return Response.json({
            rules: [{ effect: "allow" }, { effect: "deny" }],
          });
        if (path.includes("/api/mcp/config"))
          return Response.json({
            mcp_servers: {
              enabled: { enabled: true },
              disabled: { enabled: false },
            },
          });
        if (path.includes("/api/git/worktrees"))
          return Response.json(repository);
        return Response.json({});
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem("echo:recentWorkdirs");
  });

  it("reads actual rules, configurations, service and repository state", async () => {
    const onOpen = vi.fn();
    renderWithProviders(<CodingToolboxPanel onOpen={onOpen} />);
    await waitFor(() =>
      expect(screen.getByTestId("coding-tool-rules")).toHaveTextContent(
        "2 custom rules",
      ),
    );
    expect(screen.getByTestId("coding-tool-connections")).toHaveTextContent(
      "1 enabled configurations",
    );
    expect(screen.getByTestId("coding-tool-environment")).toHaveTextContent(
      "Service online",
    );
    expect(screen.getByTestId("coding-tool-git")).toHaveTextContent(
      "Repository verified",
    );
    expect(screen.getByText(/v0.1.0 · API 0.2.0/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("coding-tool-connections"));
    expect(onOpen).toHaveBeenCalledWith("tools");
    fireEvent.click(screen.getByTestId("coding-tool-worktrees"));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Starting branch",
    );
  });

  it("removes the available state when a later repository check fails", async () => {
    renderWithProviders(<CodingToolboxPanel onOpen={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByTestId("coding-tool-worktrees")).toBeEnabled(),
    );
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) =>
      String(url).includes("/api/git/worktrees")
        ? Response.json({ detail: "Project is offline" }, { status: 503 })
        : original(url, init),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(screen.getByTestId("coding-tool-worktrees")).toHaveTextContent(
        "Unavailable",
      ),
    );
    expect(screen.getByTestId("coding-tool-worktrees")).toBeDisabled();
    expect(screen.getByTestId("coding-tool-git")).toBeDisabled();
  });

  it("requires a selected project rather than claiming Git is available", () => {
    localStorage.removeItem("echo:recentWorkdirs");
    renderWithProviders(<CodingToolboxPanel />);
    expect(screen.getByTestId("coding-tool-git")).toHaveTextContent(
      "Choose a Git project",
    );
    expect(screen.getByTestId("coding-tool-worktrees")).toBeDisabled();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => String(url).includes("/api/git/worktrees")),
    ).toBe(false);
  });
});
