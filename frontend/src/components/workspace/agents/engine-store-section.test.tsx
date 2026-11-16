import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiDelete, apiGet, apiPost } from "@/core/api/request";
import type * as Request from "@/core/api/request";
import type { EngineStatus } from "@/core/engines/api";
import { renderWithProviders } from "@/test/harness";

import { EngineStoreSection } from "./engine-store-section";

vi.mock("@/core/api/request", async (original) => ({
  ...(await original<typeof Request>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

function engine(overrides: Partial<EngineStatus> = {}): EngineStatus {
  return {
    id: "codex",
    name: "Codex",
    version: "0.162.0",
    license: "Apache-2.0",
    homepage: "https://github.com/openai/codex",
    supported: true,
    download_size: 165_147_932,
    state: "not_installed",
    source: null,
    installed_version: null,
    installed_size: null,
    update_available: false,
    can_uninstall: false,
    job: null,
    ...overrides,
  };
}

const opencode = engine({
  id: "opencode",
  name: "OpenCode",
  version: "1.18.29",
  download_size: 60_655_378,
  state: "ready",
  source: "bundled",
});

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPost).mockReset();
  vi.mocked(apiDelete).mockReset();
});

describe("EngineStoreSection", () => {
  it("offers a missing engine with its download size and starts the install", async () => {
    const user = userEvent.setup();
    const installing = engine({
      state: "installing",
      job: {
        engine: "codex",
        version: "0.162.0",
        state: "downloading",
        received: 41_000_000,
        total: 165_147_932,
        source: "mirror",
      },
    });
    vi.mocked(apiGet)
      .mockResolvedValueOnce({ engines: [engine(), opencode] })
      .mockResolvedValue({ engines: [installing, opencode] });
    vi.mocked(apiPost).mockResolvedValue(installing);
    renderWithProviders(<EngineStoreSection />);

    const codex = await screen.findByTestId("engine-codex");
    expect(codex).toHaveTextContent("Not installed · About 165 MB");
    expect(screen.getByTestId("engine-opencode")).toHaveTextContent(
      "Included with the app · 1.18.29",
    );
    expect(
      within(screen.getByTestId("engine-opencode")).queryByRole("button", {
        name: /Manage OpenCode/,
      }),
    ).not.toBeNull();

    await user.click(
      within(codex).getByRole("button", { name: "Install Codex" }),
    );
    expect(apiPost).toHaveBeenCalledWith("/api/engines/{engine_id}/install", {
      path: { engine_id: "codex" },
    });
    await waitFor(() =>
      expect(codex).toHaveTextContent("Downloading from the Echo mirror · 24%"),
    );
    expect(within(codex).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "24",
    );
  });

  it("explains a failed install and lets an installed engine be removed", async () => {
    const user = userEvent.setup();
    vi.mocked(apiGet).mockResolvedValue({
      engines: [
        engine({
          job: {
            engine: "codex",
            version: "0.162.0",
            state: "failed",
            received: 0,
            total: 165_147_932,
            source: "upstream",
            error: "download_failed",
          },
        }),
        engine({
          id: "opencode",
          name: "OpenCode",
          state: "ready",
          source: "installed",
          installed_version: "1.18.29",
          can_uninstall: true,
        }),
      ],
    });
    vi.mocked(apiDelete).mockResolvedValue(
      engine({ id: "opencode", name: "OpenCode" }),
    );
    renderWithProviders(<EngineStoreSection />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "neither the Echo mirror nor the official source",
    );
    await user.click(screen.getByRole("button", { name: "Manage OpenCode" }));
    await user.click(screen.getByRole("menuitem", { name: "Uninstall" }));
    expect(apiDelete).toHaveBeenCalledWith("/api/engines/{engine_id}", {
      path: { engine_id: "opencode" },
    });
  });
});

it("updates a bundled engine independently and offers its previous version", async () => {
  const user = userEvent.setup();
  vi.mocked(apiGet).mockResolvedValue({
    engines: [
      engine({
        state: "ready",
        source: "bundled",
        can_rollback: true,
        previous_version: "0.161.0",
      }),
    ],
  });
  vi.mocked(apiPost).mockResolvedValue(engine({ state: "ready" }));
  renderWithProviders(<EngineStoreSection />);
  await user.click(await screen.findByRole("button", { name: "Manage Codex" }));
  await user.click(screen.getByRole("menuitem", { name: /Check and update/ }));
  expect(apiPost).toHaveBeenCalledWith("/api/engines/{engine_id}/update", {
    path: { engine_id: "codex" },
  });
  await user.click(await screen.findByRole("button", { name: "Manage Codex" }));
  await user.click(
    screen.getByRole("menuitem", { name: /Roll back to v0.161.0/ }),
  );
  expect(apiPost).toHaveBeenCalledWith("/api/engines/{engine_id}/rollback", {
    path: { engine_id: "codex" },
  });
});

it("shows waiting tasks and prevents duplicate changes", async () => {
  vi.mocked(apiGet).mockResolvedValue({
    engines: [
      engine({
        state: "pending_activation",
        pending_version: "0.167.0",
        active_tasks: 2,
      }),
    ],
  });
  renderWithProviders(<EngineStoreSection />);
  expect(await screen.findByText(/Waiting for 2 tasks/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Manage Codex" })).toBeNull();
});
