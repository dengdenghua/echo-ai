import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { ContextCompressor } from "./context-compressor";

describe("ContextCompressor automatic compaction", () => {
  test("waits for an active stream to settle before auto-compressing", async () => {
    const onCompress = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderWithProviders(
      <ContextCompressor
        currentTokens={95_000}
        maxTokens={100_000}
        disabled
        onCompress={onCompress}
      />,
    );

    await act(async () => {});
    expect(onCompress).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toBeEnabled();
    fireEvent.pointerDown(screen.getByRole("button"), {
      button: 0,
      ctrlKey: false,
    });
    expect(
      screen.getByRole("menuitem", { name: /Compress context/i }),
    ).toHaveAttribute("aria-disabled", "true");

    rerender(
      <ContextCompressor
        currentTokens={95_000}
        maxTokens={100_000}
        disabled={false}
        onCompress={onCompress}
      />,
    );
    await act(async () => {});

    expect(onCompress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("context-usage-trigger")).toBeEnabled();
  });

  test("does not retry on unrelated renders after a successful trigger", async () => {
    const onCompress = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderWithProviders(
      <ContextCompressor
        currentTokens={90_000}
        maxTokens={100_000}
        onCompress={onCompress}
      />,
    );
    await act(async () => {});

    rerender(
      <ContextCompressor
        currentTokens={96_000}
        maxTokens={100_000}
        onCompress={onCompress}
      />,
    );
    await act(async () => {});

    expect(onCompress).toHaveBeenCalledTimes(1);
  });

  test("shows empty and unknown capacity details without offering compression", () => {
    const { rerender } = renderWithProviders(
      <ContextCompressor currentTokens={0} maxTokens={1000} />,
    );
    const trigger = screen.getByTestId("context-usage-trigger");
    expect(trigger).toHaveAccessibleName(/0%/);
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    expect(screen.getByText("No context to compress yet")).toBeInTheDocument();
    rerender(<ContextCompressor currentTokens={20} maxTokens={0} />);
    expect(trigger).toHaveAccessibleName(/Unknown capacity/);
    expect(
      screen.getByText("Context capacity is unavailable for this model"),
    ).toBeInTheDocument();
  });

  test("keeps a manual failure visible and permits one explicit retry", async () => {
    const onCompress = vi
      .fn()
      .mockRejectedValueOnce(new Error("Compaction failed"))
      .mockResolvedValue(undefined);
    renderWithProviders(
      <ContextCompressor
        currentTokens={100}
        maxTokens={1000}
        onCompress={onCompress}
      />,
    );
    fireEvent.pointerDown(screen.getByTestId("context-usage-trigger"), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /Compress context/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Compaction failed",
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Compress context/i }));
    await waitFor(() => expect(onCompress).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  test("resets the automatic compression latch for another conversation", async () => {
    const onCompress = vi.fn().mockResolvedValue(undefined);
    const view = renderWithProviders(
      <ContextCompressor
        sessionId="one"
        currentTokens={95}
        maxTokens={100}
        onCompress={onCompress}
      />,
    );
    await waitFor(() => expect(onCompress).toHaveBeenCalledTimes(1));
    view.rerender(
      <ContextCompressor
        sessionId="two"
        currentTokens={95}
        maxTokens={100}
        onCompress={onCompress}
      />,
    );
    await waitFor(() => expect(onCompress).toHaveBeenCalledTimes(2));
  });
});
