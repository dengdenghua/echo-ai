import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ThreadProviders } from "@/components/workspace/messages/context";
import { ArtifactsProvider } from "@/components/workspace/artifacts/context";
import { ArtifactFileList } from "@/components/workspace/artifacts/artifact-file-list";
import { InlineSubagentCards } from "@/components/workspace/messages/inline-subagent-cards";
import { MessageListItem } from "@/components/workspace/messages/message-list-item";
import { FileReferenceScope } from "@/core/navigation/file-reference";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@/styles/globals.css";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const thread = {
  threadId: "layout-preview",
  messages: [],
  values: { messages: [], artifacts: [] },
  streamingMessage: null,
  subgraphStreams: {},
  isLoading: false,
  error: undefined,
  submit() {},
  stop() {},
  async refresh() {},
};
const files = [
  "workspace-output:final:设计评审报告与下一阶段验收计划-2026-10-23.md",
  "workspace-output:final:specifications/hardware/双区水循环温控主机结构与接口设计说明-修订版本.xlsx",
  "workspace-output:final:prototype/index.html",
];
const agents = [
  {
    id: "review-a",
    sessionId: "session-a",
    name: "结构设计与装配可维修性评审专家",
    role: "reviewer",
    status: "done",
    task: "核对接口、装配顺序与返修路径，整理可执行问题清单。",
    summary: "已核对装配顺序，发现 2 项工具可达性问题，详见评审报告。",
    filesTouchedCount: 3,
    iterationCount: 4,
  },
  {
    id: "review-b",
    sessionId: "session-b",
    name: "测试与验证专家",
    role: "reviewer",
    status: "running",
    task: "检查边界条件，补充回归验证。",
    filesTouchedCount: 1,
    iterationCount: 2,
  },
];
function Preview() {
  const [narrow, setNarrow] = useState(false);
  return (
    <div className="min-h-screen w-full bg-background font-sans text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-sm">
        <span>Echo · 对话组件排版验收</span>
        <button
          className="rounded-md border px-3 py-1"
          onClick={() => setNarrow(!narrow)}
        >
          {narrow ? "桌面宽度" : "窄屏 390px"}
        </button>
      </header>
      <main
        data-testid="ux-preview"
        style={{
          width: narrow ? 390 : "100%",
          maxWidth: "100%",
          margin: "auto",
        }}
      >
        <div
          className="mx-auto max-w-3xl space-y-5 px-4 py-6"
          data-testid="conversation-surface"
        >
          <MessageListItem
            allowThreadFork={false}
            message={{
              id: "human",
              type: "human",
              content: "审查结构方案，安排两个专家并行核对，把结果整理为文件。",
            }}
          />
          <MessageListItem
            allowThreadFork={false}
            message={{
              id: "assistant",
              type: "ai",
              content:
                "已完成第一轮检查。以下是目前确认的结果：\n\n## 检查结果\n\n- 接口位置与装配基准一致。\n- 两处紧固点需要调整工具进入方向。\n- 验证专家正在复核边界条件。\n\n建议先处理装配可达性，再验证修改后的样机。\n\n相关实现：[控制器接口与多通道温控逻辑的详细实现文件.ts](src/controllers/控制器接口与多通道温控逻辑的详细实现文件.ts:128)，短引用：[config.ts](src/config.ts:16-23)。",
            }}
          />
          <InlineSubagentCards events={[]} agents={agents} />
          <section aria-label="本轮产物">
            <h2 className="mb-2 text-sm font-medium">本轮产物</h2>
            <ArtifactFileList threadId="layout-preview" files={files} />
          </section>
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={client}>
    <I18nProvider initialLocale="zh-CN" initialTranslations={zhCN}>
      <MemoryRouter initialEntries={["/workspace/realtime/layout-preview"]}>
        <SidebarProvider>
          <ThreadProviders thread={thread}>
            <ArtifactsProvider threadId="layout-preview" threadExists={false}>
              <FileReferenceScope.Provider
                value={{ threadId: "layout-preview", basePath: "E:/project" }}
              >
                <Preview />
              </FileReferenceScope.Provider>
            </ArtifactsProvider>
          </ThreadProviders>
        </SidebarProvider>
      </MemoryRouter>
    </I18nProvider>
  </QueryClientProvider>,
);
