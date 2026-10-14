# 子进程侧栏排版回归（2026-09-26）

## 复现与修正

使用真实 SubagentProcessView、消息渲染器和全局样式，在 Chromium 中以 320、400、640 px 宽度挂载。测试数据包含长协作者名称、工具输出、Markdown 代码和表格。

- 修复前：320 px 出现控件越界；400 px 的操作按钮因中文逐字换行达到 80.75 px 高。640 px 未复现挤压。
- 标题与操作区分行，操作按钮整体换行，主电脑入口保留宽度；追问输入和发送按钮按面板可用宽度换行。
- 补齐内容容器宽度约束、减少侧栏内边距，流式自动滚动限定在侧栏内部。
- 工具 observation 不再复制为 reasoning；空输出工具回执也能结束运行状态；合并工具步骤后仍显示最新实时输出。

## 验证

- Chromium 三种宽度均通过：控件边界、按钮高度、输入可用宽度、装入草稿、返回主电脑、实时输出、无重复思考、无浏览器异常。
- 工作台、子进程交互、消息组相关单测：182 通过，2 个既有跳过。
- TypeScript `npx tsc --noEmit` 通过。

复现命令（PowerShell，在 frontend 目录运行）：

```powershell
$env:FRONTEND_PORT='13320'
npx playwright test e2e/subagent-layout.spec.ts --project chromium --workers 1 --reporter=list
npx vitest run src/components/workspace/agent-workbench-panel/subagent-process-view.test.tsx src/components/workspace/agent-workbench-panel.test.tsx src/components/workspace/messages/message-group.test.tsx
npx tsc --noEmit
```

浏览器测试为隔离的组件集成回归，使用真实组件、模拟事件数据，不连接生产群聊或调用模型；不代表重新执行了完整登录与多人会话端到端测试。修改位于源码，未发布桌面安装包。
