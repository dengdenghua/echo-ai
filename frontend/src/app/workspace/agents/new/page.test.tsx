import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";
import NewAgentPage from "./page";

vi.mock("@/components/workspace/agents/profession-picker", () => ({
  ProfessionPicker: () => null,
}));
vi.mock("@/components/workspace/agents/cloud-agent-creation", () => ({
  CloudAgentCreation: () => null,
}));
vi.mock("@/components/workspace/chat-input-box", () => ({
  ChatInputBox: () => null,
}));
vi.mock("@/components/workspace/messages", () => ({
  MessageList: () => null,
}));
vi.mock("@/core/threads/hooks", () => ({
  useThreadStream: () => [{ isLoading: false, messages: [] }, vi.fn()],
}));

it("summarizes the guided config in plain language and hides raw ids behind technical details", async () => {
  const user = userEvent.setup();
  renderWithProviders(<NewAgentPage />, {
    locale: "zh-CN",
    initialRoute: "/workspace/agents/new",
  });

  const summary = await screen.findByTestId("agent-config-summary");
  expect(summary).toHaveTextContent("生成后，它可以");
  expect(summary).toHaveTextContent(
    "知识库 · 读取并归纳知识库、文件和历史上下文。",
  );
  expect(summary).toHaveTextContent("权限与边界");
  expect(summary).toHaveTextContent("读取工作区资料");
  // Internal identifiers are not part of the visible summary.
  expect(summary).not.toHaveTextContent("ARM:");
  expect(summary).not.toHaveTextContent("read_knowledge");
  expect(summary).not.toHaveTextContent("agent-generator");

  const details = within(summary).getByRole("button", { name: "技术细节" });
  expect(details).toHaveAttribute("aria-expanded", "false");
  await user.click(details);
  expect(details).toHaveAttribute("aria-expanded", "true");
  expect(summary).toHaveTextContent("ARM: knowledge, files");
  expect(summary).toHaveTextContent(
    "Skill: agent-generator, read_knowledge, summarize_docs, cite_sources",
  );
});

it("updates the plain-language summary when another capability pack is selected", async () => {
  const user = userEvent.setup();
  renderWithProviders(<NewAgentPage />, {
    locale: "en-US",
    initialRoute: "/workspace/agents/new",
  });

  const summary = await screen.findByTestId("agent-config-summary");
  expect(summary).toHaveTextContent("Once created, it can");
  expect(summary).toHaveTextContent("Permissions and limits");
  expect(summary).not.toHaveTextContent("Web Research");

  await user.click(screen.getByRole("button", { name: "Web Research" }));
  expect(summary).toHaveTextContent("Web Research · ");
  expect(summary).not.toHaveTextContent("web_search");
});
