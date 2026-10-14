import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { ClarificationChoiceCard } from "./clarification-choice-card";

const CHOICES = [
  "Please choose an output format:",
  "A. Short answer",
  "B. Detailed report",
].join("\n");

describe("ClarificationChoiceCard · typed answers", () => {
  const quickReply = vi.fn();
  const listen = (event: Event) => {
    if (event instanceof CustomEvent) quickReply(event.detail);
  };
  window.addEventListener("echo:quick-reply", listen);

  afterEach(() => quickReply.mockReset());

  it("lets Enter confirm an IME candidate without sending half a word", () => {
    renderWithProviders(
      <ClarificationChoiceCard content={CHOICES} active messageId="ime" />,
      { locale: "zh-CN" },
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "中文回" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(quickReply).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "中文回答" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(quickReply).toHaveBeenCalledWith(
      expect.objectContaining({ text: "中文回答" }),
    );
  });

  it("names the send button and the waiting note in the reader's language", () => {
    renderWithProviders(
      <ClarificationChoiceCard content={CHOICES} active messageId="names" />,
    );
    expect(
      screen.getByRole("button", { name: "Send this answer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pick an answer to continue; nothing is answered for you",
      ),
    ).toBeInTheDocument();
  });
});
