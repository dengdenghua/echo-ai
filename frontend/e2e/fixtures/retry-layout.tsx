import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales";
import { MessageListItem } from "@/components/workspace/messages/message-list-item";
import {
  mergeOptimisticHumanMessages,
  type PendingOutboundMessage,
} from "@/core/threads/optimistic-messages";
import type { Message } from "@/core/api/types";
import "@/styles/globals.css";
const root = createRoot(document.getElementById("root")!),
  client = new QueryClient();
const failed = (id: string): PendingOutboundMessage => ({
  clientMessageId: id,
  threadId: "qa",
  intent: "start",
  message: { text: "继续", files: [] },
  displayText: "继续",
  createdAt: "2026-10-20T00:00:00Z",
  afterMessageId: "answer",
  deliveryState: "failed",
});
const host = window as unknown as {
  renderRetry: (stage: number) => void;
  ready: boolean;
};
host.renderRetry = (stage) => {
  const server: Message[] = [
    { id: "request", type: "human", content: "检查当前模型" },
    { id: "answer", type: "ai", content: "已检查当前模型。" },
  ];
  if (stage)
    server.push(
      { id: "retry", type: "human", content: "继续" },
      {
        id: "result",
        type: "ai",
        content: "重试成功，继续输出结果。\n\n".repeat(stage === 2 ? 35 : 1),
      },
    );
  const messages = mergeOptimisticHumanMessages(server, [
    failed("retry"),
    failed("failed"),
  ]);
  root.render(
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale="zh-CN" initialTranslations={zhCN}>
        <MemoryRouter>
          <div
            id="scroll"
            style={{
              height: "90vh",
              overflowY: "auto",
              maxWidth: 760,
              margin: "20px auto",
              padding: 16,
            }}
          >
            {messages.map((message) => (
              <div
                key={message.id}
                data-qa-message={message.id}
                style={{ marginBottom: 24 }}
              >
                <MessageListItem message={message} allowThreadFork={false} />
              </div>
            ))}
          </div>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
};
host.renderRetry(0);
host.ready = true;
