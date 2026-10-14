import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { registerSessionStatusMenu } from "@/core/realtime/session-status-menu";
import { renderWithProviders } from "@/test/harness";

import { ContextWindowBar } from "./ContextWindowBar";

function openPopover() {
  const trigger = screen.getByTestId("chat-context-window-trigger");
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

describe("ContextWindowBar", () => {
  it("compresses from the popover when the page has no side panel", async () => {
    const onCompressContext = vi.fn();
    renderWithProviders(
      <ContextWindowBar
        contextTokens={50_000}
        maxContextTokens={100_000}
        onCompressContext={onCompressContext}
      />,
    );
    openPopover();
    fireEvent.click(await screen.findByRole("button", { name: "Compress" }));
    expect(onCompressContext).toHaveBeenCalledTimes(1);
  });

  it("hands compression to the header status menu when one is mounted", async () => {
    const onCompressContext = vi.fn();
    const openMenu = vi.fn();
    const unregister = registerSessionStatusMenu(openMenu);
    try {
      renderWithProviders(
        <ContextWindowBar
          contextTokens={50_000}
          maxContextTokens={100_000}
          onCompressContext={onCompressContext}
        />,
      );
      openPopover();
      expect(await screen.findByText("Free space")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Compress" }),
      ).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", {
          name: "View and compress in the status panel",
        }),
      );
      await waitFor(() => expect(openMenu).toHaveBeenCalledTimes(1));
      expect(onCompressContext).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("steps aside for the header menu until the window is filling", () => {
    const unregister = registerSessionStatusMenu(vi.fn());
    try {
      const { rerender } = renderWithProviders(
        <ContextWindowBar contextTokens={20_000} maxContextTokens={100_000} />,
      );
      expect(screen.queryByTestId("chat-context-window-trigger")).toBeNull();
      rerender(
        <ContextWindowBar contextTokens={60_000} maxContextTokens={100_000} />,
      );
      expect(
        screen.getByTestId("chat-context-window-trigger"),
      ).toBeInTheDocument();
    } finally {
      unregister();
    }
  });
});
