import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";
import { ClarificationChoiceCard } from "./clarification-choice-card";

// The structured result shape emitted by the `ask_user_question` skill.
const ASK_USER_RESULT = JSON.stringify({
  ok: true,
  posted: true,
  question: "Which output format do you prefer?",
  options: ["Short answer", "Detailed report"],
  allow_other: true,
});

function listenForQuickReply() {
  const quickReply = vi.fn();
  const handler = (event: Event) => {
    if (event.type === "echo:quick-reply") {
      quickReply((event as CustomEvent<{ text?: string }>).detail);
    }
  };
  window.addEventListener("echo:quick-reply", handler);
  return {
    quickReply,
    cleanup: () => window.removeEventListener("echo:quick-reply", handler),
  };
}

describe("ClarificationChoiceCard · clarification affordances", () => {
  test("pages long questionnaires, preserves drafts and submits only after review", () => {
    const { quickReply, cleanup } = listenForQuickReply();
    try {
      renderWithProviders(<ClarificationChoiceCard active messageId="paged" content={JSON.stringify({
        type: "clarification_questionnaire", questions: Array.from({length: 4}, (_, index) => ({
          id: `q${index}`, title: `问题${index + 1}`, options: ["方案甲", "方案乙"],
        })),
      })} />);
      fireEvent.click(screen.getByRole("button", { name: "开始 / 继续填写" }));
      expect(screen.getByRole("status")).toHaveTextContent("第 1 / 4 题");
      expect(screen.queryByLabelText("补充回答：问题2")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("radio", { name: "方案甲" }));
      fireEvent.click(screen.getByRole("radio", { name: "方案乙" }));
      expect(screen.getByRole("radio", { name: "方案甲" })).not.toBeChecked();
      fireEvent.click(screen.getByRole("radio", { name: "方案甲" }));
      expect(screen.getByRole("status")).toHaveTextContent("第 1 / 4 题");
      fireEvent.click(screen.getByRole("button", { name: "下一步" }));
      fireEvent.change(screen.getByLabelText("补充回答：问题2"), { target: {value: "我的补充"} });
      fireEvent.click(screen.getByRole("button", { name: /关闭|Close/ }));
      fireEvent.click(screen.getByRole("button", { name: "开始 / 继续填写" }));
      expect(screen.getByLabelText("补充回答：问题2")).toHaveValue("我的补充");
      fireEvent.click(screen.getByRole("button", { name: "下一步" }));
      fireEvent.click(screen.getByRole("button", { name: "暂不确定" }));
      fireEvent.click(screen.getByRole("button", { name: "预览回答" }));
      expect(quickReply).not.toHaveBeenCalled();
      expect(screen.getByText("我的补充")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "修改第 1 题" }));
      expect(screen.getByRole("radio", { name: "方案甲" })).toBeChecked();
      fireEvent.click(screen.getByRole("button", { name: "查看全部" }));
      expect(screen.getByLabelText("补充回答：问题4")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "预览回答" }));
      fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
      expect(quickReply).toHaveBeenCalledTimes(1);
      expect(quickReply.mock.calls[0][0].text).toContain("我的补充");
    } finally { cleanup(); }
  });
  test("keeps multi-select and written answers when the questionnaire is enlarged", () => {
    const { quickReply, cleanup } = listenForQuickReply();
    try {
      renderWithProviders(<ClarificationChoiceCard active messageId="multi" content={JSON.stringify({
        type: "clarification_questionnaire", questions: [
          { id: "features", title: "功能？", multiple: true, options: ["温控", "监测"] },
          { id: "budget", title: "预算？", options: [] },
        ],
      })} />);
      fireEvent.click(screen.getByRole("checkbox", { name: "温控" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "监测" }));
      expect(screen.getByRole("checkbox", { name: "温控" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "监测" })).toBeChecked();
      fireEvent.click(screen.getAllByRole("checkbox", { name: "还没想好，让 AI 建议" })[0]!);
      expect(screen.getByRole("checkbox", { name: "温控" })).not.toBeChecked();
      fireEvent.click(screen.getByRole("checkbox", { name: "温控" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "监测" }));
      expect(screen.getAllByRole("checkbox", { name: "还没想好，让 AI 建议" })[0]).not.toBeChecked();
      fireEvent.change(screen.getByLabelText("补充回答：预算？"), {target: {value: "尚未确定"}});
      fireEvent.click(screen.getByRole("button", {name: "放大填写"}));
      expect(screen.getByRole("dialog")).toBeVisible();
      expect(screen.getByLabelText("补充回答：预算？")).toHaveValue("尚未确定");
      fireEvent.click(screen.getByRole("button", {name: "提交回答"}));
      expect(quickReply).toHaveBeenCalledTimes(1);
      expect(quickReply.mock.calls[0][0]).toMatchObject({sourceMessageId: "multi", text: expect.stringContaining("温控；监测")});
      expect(quickReply.mock.calls[0][0].text).toContain("尚未确定");
    } finally { cleanup(); }
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("renders an Other free-text input for a structured single question", () => {
    renderWithProviders(
      <ClarificationChoiceCard content={ASK_USER_RESULT} active messageId="m1" />,
      { locale: "en-US" },
    );
    expect(screen.getByPlaceholderText(/Other/i)).toBeInTheDocument();
  });

  test("submits a custom answer only after explicit submission", () => {
    const { quickReply, cleanup } = listenForQuickReply();
    try {
      renderWithProviders(
        <ClarificationChoiceCard content={ASK_USER_RESULT} active messageId="m1" />,
        { locale: "en-US" },
      );
      const input = screen.getByPlaceholderText(/Other/i);
      fireEvent.change(input, { target: { value: "A one-page summary" } });
      fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
      expect(quickReply).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("A one-page summary") }),
      );
    } finally {
      cleanup();
    }
  });

  test("never auto-submits an unanswered question", () => {
    vi.useFakeTimers();
    const { quickReply, cleanup } = listenForQuickReply();
    try {
      renderWithProviders(
        <ClarificationChoiceCard content={ASK_USER_RESULT} active messageId="m1" />,
        { locale: "en-US" },
      );
      act(() => {
        vi.advanceTimersByTime(20000);
      });
      expect(quickReply).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  test("renders an Other free-text input for the plain-text fallback card", () => {
    renderWithProviders(
      <ClarificationChoiceCard
        content={"请选择一个方向：\n\nA. 方案甲\nB. 方案乙"}
        active
        messageId="m1"
      />,
      { locale: "en-US" },
    );
    expect(screen.getByPlaceholderText(/Other/i)).toBeInTheDocument();
  });
});

