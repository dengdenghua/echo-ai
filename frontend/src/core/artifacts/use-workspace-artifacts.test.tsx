import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ACTIVE_ARTIFACT_REFRESH_MS } from "./polling";
import { useWorkspaceArtifacts } from "./use-workspace-artifacts";

const mocks = vi.hoisted(() => ({
  listing: ["workspace-output:output:report.md"],
  list: vi.fn(),
}));

vi.mock("./workspace-outputs", () => ({
  listWorkspaceArtifactRefs: mocks.list,
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useWorkspaceArtifacts polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listing = ["workspace-output:output:report.md"];
    mocks.list.mockReset();
    mocks.list.mockImplementation(async () => [...mocks.listing]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("backs off while the listing stays the same and snaps back on a change", async () => {
    renderHook(
      () =>
        useWorkspaceArtifacts("thread-1", {
          refetchInterval: ACTIVE_ARTIFACT_REFRESH_MS,
        }),
      { wrapper },
    );
    await advance(0);
    expect(mocks.list).toHaveBeenCalledTimes(1);

    // Same list each time: the waits run 3 s, 6 s, 12 s, then hold at 15 s.
    await advance(3_000);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    await advance(6_000);
    expect(mocks.list).toHaveBeenCalledTimes(3);
    await advance(11_000);
    expect(mocks.list).toHaveBeenCalledTimes(3);
    await advance(1_000);
    expect(mocks.list).toHaveBeenCalledTimes(4);
    await advance(15_000);
    expect(mocks.list).toHaveBeenCalledTimes(5);

    // A new file shows up: the next listing comes 3 s later again.
    mocks.listing = [...mocks.listing, "workspace-output:output:chart.png"];
    await advance(15_000);
    expect(mocks.list).toHaveBeenCalledTimes(6);
    await advance(3_000);
    expect(mocks.list).toHaveBeenCalledTimes(7);
  });

  test("does not poll without an interval", async () => {
    renderHook(
      () => useWorkspaceArtifacts("thread-1", { refetchInterval: false }),
      { wrapper },
    );
    await advance(0);
    await advance(30_000);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
});
