import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { StreamingSendActions } from "./StreamingSendActions";

describe("streaming group send controls", () => {
  it("offers actual group queue submission without a second local follow-up button", () => {
    const send = vi.fn(),
      later = vi.fn();
    renderWithProviders(
      <StreamingSendActions
        group
        busy={false}
        blocked={false}
        hasAttachments
        blockedLabel="offline"
        onSubmit={send}
        onQueueLater={later}
      />,
    );
    fireEvent.click(screen.getByTestId("chat-queue-button"));
    expect(send).toHaveBeenCalledOnce();
    expect(later).not.toHaveBeenCalled();
    expect(screen.queryByTestId("chat-steer-button")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
  it("keeps private steering and prevents submissions during upload or disconnect", () => {
    const send = vi.fn();
    const { rerender } = renderWithProviders(
      <StreamingSendActions
        group={false}
        busy={false}
        blocked={false}
        hasAttachments={false}
        blockedLabel="offline"
        onSubmit={send}
        onQueueLater={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("chat-steer-button"));
    expect(send).toHaveBeenCalledOnce();
    rerender(
      <StreamingSendActions
        group
        busy
        blocked
        hasAttachments={false}
        blockedLabel="offline"
        onSubmit={send}
        onQueueLater={vi.fn()}
      />,
    );
    expect(screen.getByTestId("chat-queue-button")).toBeDisabled();
    fireEvent.click(screen.getByTestId("chat-queue-button"));
    expect(send).toHaveBeenCalledOnce();
  });
});
