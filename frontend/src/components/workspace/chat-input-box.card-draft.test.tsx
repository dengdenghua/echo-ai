import { act, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";
import { eventBus } from "@/core/events/event-bus";
import { ChatInputBox } from "./chat-input-box";

it("preserves a card draft until confirmation and never submits into a different chat", async () => {
  const submit = vi.fn();
  renderWithProviders(
    <ChatInputBox
      mode="react"
      threadId="card-receipt"
      defaultValue="my draft"
      onSubmit={submit}
    />,
  );
  const onResult = vi.fn();
  act(() =>
    eventBus.emit("composer:submit-request", {
      threadId: "other",
      clientMessageId: "ui-other",
      text: "wrong",
      onResult,
    }),
  );
  expect(submit).not.toHaveBeenCalled();
  act(() =>
    eventBus.emit("composer:submit-request", {
      threadId: "card-receipt",
      clientMessageId: "ui-card",
      text: "publish report",
      onResult,
    }),
  );
  expect(submit).toHaveBeenCalledWith({
    text: "publish report",
    clientMessageId: "ui-card",
  });
  expect(screen.getByRole("textbox")).toHaveValue(
    "my draft\n\npublish report",
  );
  act(() =>
    eventBus.emit("composer:request-settled", {
      threadId: "card-receipt",
      clientMessageId: "ui-card",
      result: "confirmed",
    }),
  );
  expect(screen.getByRole("textbox")).toHaveValue("my draft");
});

it("keeps the recovery draft when the mutation boundary rejects a card action", () => {
  const submit = vi.fn(() => false);
  const onResult = vi.fn();
  renderWithProviders(
    <ChatInputBox mode="react" threadId="card-rejected" onSubmit={submit} />,
  );
  act(() =>
    eventBus.emit("composer:submit-request", {
      threadId: "card-rejected",
      clientMessageId: "ui-card",
      text: "publish report",
      onResult,
    }),
  );
  expect(onResult).toHaveBeenCalledWith("failed");
  expect(screen.getByRole("textbox")).toHaveValue("publish report");
});
