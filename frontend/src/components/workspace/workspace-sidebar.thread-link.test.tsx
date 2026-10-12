import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as SidebarModule from "@/core/threads/sidebar";
import { renderWithProviders } from "@/test/harness";

const syncThreadAgentSelection = vi.hoisted(() => vi.fn());

vi.mock("@/core/threads/sidebar", async (importOriginal) => ({
  ...(await importOriginal<typeof SidebarModule>()),
  syncThreadAgentSelection,
}));

const { __testing } = await import("./workspace-sidebar");
const ChatsSection = __testing.ChatsSection;

describe("sidebar thread links", () => {
  beforeEach(() => {
    syncThreadAgentSelection.mockClear();
    window.localStorage.setItem("echo.sidebar.chats-open", "1");
  });

  it("switches the thread owner on click, not mousedown", () => {
    // The thread queries are keyed by the active agent; switching it at
    // mousedown refetched the list and unmounted the link before the click
    // could navigate (reproduced from /workspace/realtime/new).
    renderWithProviders(
      <ChatsSection
        pathname="/workspace/realtime/new"
        threads={[
          {
            id: "thread-1",
            title: "Hello thread",
            updatedAt: "2026-10-05T00:00:00Z",
            mode: "chat",
            href: "/workspace/realtime/thread-1",
            agents: ["eve"],
          },
        ]}
      />,
      { initialRoute: "/workspace/realtime/new" },
    );

    const link = screen.getByRole("link", { name: /Hello thread/ });
    fireEvent.mouseDown(link);
    expect(syncThreadAgentSelection).not.toHaveBeenCalled();

    fireEvent.click(link);
    expect(syncThreadAgentSelection).toHaveBeenCalledWith(["eve"]);
  });
});
