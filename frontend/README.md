# echo-ai · Web UI

Vite + React 19 + TypeScript + Tailwind。支持浏览器开发与 Electron 打包，生产产物由 FastAPI 挂载到 `/ui/`。

## 开发

```bash
corepack enable
make frontend-install   # 或 cd frontend && pnpm install --frozen-lockfile
make frontend-dev       # vite dev server · localhost:3310
# 另开终端起后端：
#   echo-ai serve --port 8310
# /api/* 和 /v1/* 自动代理到 8310
```

## 生产 build

```bash
make frontend-build
# 产出 frontend/dist/
# 后端 create_app 会自动探测并挂到 /ui/
# 或设环境变量 ECHO_WEBUI_DIST 指定路径
```

## Docker

`Dockerfile` 是三阶段 · 自动：

1. `node:22-alpine` build frontend → /webui/dist
2. `python:3.12-slim` uv sync
3. runtime · COPY --from=webui-builder → /app/webui
   · 设 `ECHO_WEBUI_DIST=/app/webui` · WebUI 自动挂载

## 路由

所有业务页面在 `/workspace` layout 下，由 `src/router.tsx` 统一注册。
当前产品入口已经收敛到 realtime-first workspace：

- `/workspace` 默认进入 `/workspace/realtime/new`。
- `/workspace/realtime/:threadId` 是单人对话 / 任务执行主界面，使用 `/api/realtime` WebSocket JSON-RPC item protocol。
- `/workspace/chats/:threadId` 保留为旧链接兼容入口，但渲染同一个 `ChatPage`，不再代表独立 SSE chat transport。
- `/workspace/code*` 保留为旧链接兼容入口，并重定向到 realtime；coding 是 thread/runtime 内的工作模式，不是独立页面产品面。
- `/workspace/team*` 是团队模式，独立于单人 realtime 对话。

| 页面                  | 路径                            | 后端 API                                              |
| --------------------- | ------------------------------- | ----------------------------------------------------- |
| Landing               | `/`                             | —                                                     |
| Login / Register      | `/login`, `/register`           | `/api/auth/*`                                         |
| Realtime conversation | `/workspace/realtime/:threadId` | `/api/realtime` WebSocket                             |
| Legacy chat link      | `/workspace/chats/:threadId`    | 同 `Realtime conversation`                            |
| Legacy code link      | `/workspace/code*`              | 重定向到 `/workspace/realtime/*`                      |
| Team                  | `/workspace/team*`              | `/api/teams/*`                                        |
| Agents                | `/workspace/agents`             | `/api/agents`                                         |
| Skills                | `/workspace/skills`             | `/api/skills`                                         |
| Channels              | `/workspace/channels`           | `/api/channels`                                       |
| MCP                   | `/workspace/mcp`                | `/api/mcp/*`                                          |
| Browser               | `/workspace/browser`            | `/api/browser/*`                                      |
| Computer              | `/workspace/computer`           | `/api/computer/*`                                     |
| Observability         | `/workspace/observability`      | `/api/stream` `/api/journal` `/api/kg` `/api/reflect` |
| Workflows             | `/workspace/workflows`          | `/api/workflows/*`                                    |
| Intelligence          | `/workspace/intelligence`       | `/api/intel/*`                                        |
| Swarm                 | `/workspace/swarm`              | `/api/swarm/*`                                        |
| Knowledge             | `/workspace/knowledge`          | `/api/kg/*`                                           |
| Evolution             | `/workspace/evolution`          | `/api/evolution/*`                                    |
| Reflex                | `/workspace/reflex`             | `/api/reflex/*`                                       |
| Architecture          | `/workspace/architecture`       | — (纯前端可视化)                                      |
| Realtime dev index    | `/realtime`                     | `/api/realtime` WebSocket                             |
| Desktop               | `/desktop`                      | — (Electron 专用)                                     |

## 设计

### 执行位置

Realtime 输入框下方的工作空间/模式状态栏右侧显示执行位置，与加号附件操作分开；执行引擎仍位于输入框内。选择远程电脑前会检查连接；切换会打开目标电脑的新任务，当前聊天保留。有草稿、附件或正在运行的任务时禁止切换。

远程注册表、SSH 和 HTTP/WebSocket 转发需要本地服务启用 `ECHO_FF_UI_REMOTE_TRANSPORT=1`。通过输入框的“管理远程电脑”添加地址和凭据，远程凭据仅保存在后端。认证部署还要求本地账号具有 operator/admin 权限。

`echoRemote` 是当前窗口 URL 中的注册电脑 ID；远程 HTTP 走 `/api/remote-backends/{id}/http/api/*`，实时连接走同一路径下的 `/api/realtime`。登录与电脑管理始终连接本地网关。工作目录、模型偏好与草稿按电脑隔离，远程目录使用路径输入或目录浏览，不调用本机文件夹对话框。云端任务执行尚未接入，入口显示为不可用。

### 上下文、排队与改动审查

上下文圆环常驻模型左侧，手机端也可点击查看当前对话的估算用量、剩余容量与压缩状态。运行中允许查看详情，压缩等待任务结束。

普通 Realtime 任务运行时，发送按钮旁的菜单提供“补充当前任务”和“排队发送”。队列暂支持纯文本，可编辑、删除、暂停或重试；逐条等待服务端消息回执，当前任务完成后发送下一条。停止、中断或发送失败会暂停队列。队列按电脑和会话保存在当前窗口的 sessionStorage，刷新后暂停；未确认送达的消息先检查对话，再手动重试。未完成的队列也会阻止切换执行位置。群组和嵌入式设计聊天暂不提供排队入口。

Diff 面板可选择本轮工具记录或整个会话的最近文件记录，支持按完整路径搜索、增删行统计、折叠与“已查看”标记。同名文件按路径区分；差异变化后已查看标记失效。该范围来自工具事件，不能代替 Git 的暂存/未暂存状态。

- **Dark only**（短期）· 配色 ink（深蓝灰）+ cephalo（紫）+ sucker（cyan）
- **Radix 原语 + Tailwind 组合**（无 MUI / antd）· 轻量 headless 基础 + 自定义样式
- **TypeScript 严格**（`strict: true`）
- **后端契约** → `src/core/api/openapi-types.ts`（openapi-typescript 自动生成）· 后端改请同步 `npm run generate-types`

## Size 预算

使用 `vite build --reportCompressedSize` 查看最新产物体积。
构建配置中 `chunkSizeWarningLimit: 1400 KB`，超出会告警。
主要 vendor chunk 按 react / radix / codemirror / tanstack-query 拆分。
