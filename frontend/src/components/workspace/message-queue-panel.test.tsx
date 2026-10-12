import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MessageQueueControl } from "@/core/threads/use-message-queue";
import { MessageQueuePanel } from "./message-queue-panel";

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({ locale: "zh-CN" }),
}));

function queue(
  overrides: Partial<MessageQueueControl> = {},
): MessageQueueControl {
  return {
    items: [{ id: "itm_queue_test", text: "待发送内容", state: "uncertain" }],
    paused: true,
    recovering: false,
    storageUnavailable: false,
    canSteer: false,
    enqueue: vi.fn(),
    remove: vi.fn(),
    edit: vi.fn(),
    retry: vi.fn(),
    steer: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    ...overrides,
  };
}

describe("MessageQueuePanel recovery", () => {
  it("lets the user pause automatic recovery while delivery is being checked", () => {
    const control = queue({ recovering: true });
    render(<MessageQueuePanel queue={control} />);
    expect(screen.getByText("核对送达状态")).toBeInTheDocument();
    expect(screen.getByText("等待连接恢复并确认送达")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "继续队列" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "暂停队列" }));
    expect(control.pause).toHaveBeenCalledOnce();
    expect(control.resume).not.toHaveBeenCalled();
  });

  it("keeps manual resume available for a restored or deliberately paused queue", () => {
    const control = queue();
    render(<MessageQueuePanel queue={control} />);
    expect(screen.getByText("已暂停")).toBeInTheDocument();
    expect(screen.getByText("送达状态未知，请先检查对话")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续队列" }));
    expect(control.resume).toHaveBeenCalledOnce();
    expect(control.pause).not.toHaveBeenCalled();
  });
});
