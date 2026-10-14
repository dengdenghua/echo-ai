import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { enUS } from "@/core/i18n/locales/en-US";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import { renderWithProviders } from "@/test/harness";

import {
  createGroupRenderers,
  type GroupRendererContext,
} from "./message-list-renderers";

function frame(locale: "en-US" | "zh-CN" | "ja-JP") {
  const { renderAssistantFrame } = createGroupRenderers({
    ...({} as GroupRendererContext),
    t: locale === "zh-CN" ? zhCN : enUS,
    locale,
    showSenderName: true,
  });
  return renderAssistantFrame({
    key: "eve",
    agentName: "Eve",
    agentRole: "tl",
    replyTo: "Luna",
    children: <p>answer</p>,
  });
}

describe("assistant speaker frame", () => {
  it.each([
    ["zh-CN", "队长", "↪ 回应 @Luna", "Eve · 查看成员信息"],
    ["en-US", "Lead", "↪ replying to @Luna", "Eve · view member profile"],
    ["ja-JP", "リーダー", "↪ @Luna への返信", "Eve · メンバー情報を表示"],
  ] as const)(
    "names the lead and the reply target in %s",
    (locale, lead, reply, profile) => {
      renderWithProviders(frame(locale));
      expect(screen.getByText(lead)).toBeInTheDocument();
      expect(screen.getByText(reply)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: profile })).toBeInTheDocument();
    },
  );
});
