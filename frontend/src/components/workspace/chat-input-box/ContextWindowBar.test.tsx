import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

  it("hands compression to the side panel when one is available", async () => {
    const onCompressContext = vi.fn();
    const onOpenDetails = vi.fn();
    renderWithProviders(
      <ContextWindowBar
        contextTokens={50_000}
        maxContextTokens={100_000}
        onCompressContext={onCompressContext}
        onOpenDetails={onOpenDetails}
      />,
    );
    openPopover();
    expect(await screen.findByText("Free space")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Compress" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "View and compress in the side panel",
      }),
    );
    expect(onOpenDetails).toHaveBeenCalledTimes(1);
    expect(onCompressContext).not.toHaveBeenCalled();
  });
});
