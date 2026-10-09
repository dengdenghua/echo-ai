import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../src/core/i18n/context";
import { zhCN } from "../../src/core/i18n/locales";
import { SubagentProcessView } from "../../src/components/workspace/agent-workbench-panel/subagent-process-view";
import "../../src/styles/globals.css";

document.cookie = "locale=zh-CN; path=/";
const root = createRoot(document.getElementById("root")!);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const longPath =
  "workspace/" + "collaboration-module/".repeat(10) + "report.ts";

export function renderPanel(width: number, running = false) {
  root.render(
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale="zh-CN" initialTranslations={zhCN}>
        <MemoryRouter>
          <div
            data-testid="panel"
            style={{
              width,
              height: 740,
              display: "flex",
              flexDirection: "column",
              marginLeft: "auto",
              border: "1px solid #999",
            }}
          >
            <SubagentProcessView
              agent={{
                id: "layout-agent",
                name: "planner",
                codename: "工程架构规划与协作验证专家",
                label: "01",
                task: "检查多人协作流程并整理交付方案。",
                status: running ? "running" : "done",
                resultSummary: running
                  ? undefined
                  : `## 验证结果\n\n任务已完成，支持继续追问。\n\n\`\`\`text\n${longPath}\n\`\`\`\n\n| 项目 | 文件 |\n| --- | --- |\n| 交付 | ${longPath} |`,
                blackboardWrites: [],
                filesTouched: [],
                eventCount: 1,
                startedAt: 1000,
              }}
              blocks={[
                {
                  id: "layout-block",
                  event: {
                    id: "layout-event",
                    name: "read_file",
                    status: running ? "running" : "done",
                    input: { path: longPath },
                    observation: "已读取协作配置。",
                    iteration: 1,
                    startedAt: 1000,
                  },
                  title: "读取协作配置",
                  status: "done",
                  outputText: "已读取协作配置。",
                  kind: "tool_use",
                  actionKey: "read_file",
                  target: longPath,
                  subtitle: "planner",
                  startedAt: 1000,
                  inputText: longPath,
                },
              ]}
              onOpenMain={() => {
                document.body.dataset.mainOpened = "true";
              }}
            />
          </div>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}
