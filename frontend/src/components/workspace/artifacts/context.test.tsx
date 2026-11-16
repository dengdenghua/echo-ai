import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ArtifactsProvider, useArtifacts } from "./context";

vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ setOpen: vi.fn() }),
}));
vi.mock("@/env", () => ({ env: { STATIC_WEBSITE_ONLY: false } }));
vi.mock("@/core/artifacts/use-workspace-artifacts", () => ({
  useWorkspaceArtifacts: () => ({ data: undefined }),
}));

describe("artifact navigation protection", () => {
  it("preserves the current resource when its discard confirmation is declined", async () => {
    const { result } = renderHook(useArtifacts, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ArtifactsProvider threadId="t1">{children}</ArtifactsProvider>
      ),
    });
    act(() => result.current.select("workspace-output:final:edited.html"));
    const guard = vi.fn().mockResolvedValue(false);
    act(() => {
      result.current.registerNavigationGuard(guard);
    });
    await act(async () =>
      result.current.select("file-reference:next", false, "8"),
    );
    expect(guard).toHaveBeenCalledOnce();
    expect(result.current.selectedArtifact).toBe(
      "workspace-output:final:edited.html",
    );
    expect(result.current.selectedLines).toBeUndefined();
  });
  it("never applies an old confirmation to the next conversation", async () => {
    let complete!: (allowed: boolean) => void;
    let threadId = "t1";
    const { result, rerender } = renderHook(useArtifacts, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ArtifactsProvider threadId={threadId}>{children}</ArtifactsProvider>
      ),
    });
    act(() => result.current.select("old.html"));
    act(() => {
      result.current.registerNavigationGuard(
        () =>
          new Promise<boolean>((resolve) => {
            complete = resolve;
          }),
      );
      result.current.select("other.html");
    });
    threadId = "t2";
    rerender();
    await act(async () => complete(true));
    expect(result.current.selectedArtifact).toBeNull();
  });
});
