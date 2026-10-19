# 应用桥接接口

此接口只在 HUB → 应用 → 我的应用打开时由宿主注入。不要复制宿主凭据、加载远程 SDK、直接 fetch 后台或请求 `allow-same-origin`。直接打开开发目录里的 HTML 时 `window.echo` 不存在，应显示开发预览提示，不能静默丢弃保存操作。

## 数据保存

在 `app.json` 声明 `"permissions": ["app.storage"]`。

```js
let documentState = await window.echo.storage.get("state");
// { value: null, revision: 0, deleted: true } 表示还没有这个文档。
const state = documentState.value ?? { customers: [] };

async function save(nextState) {
  documentState = await window.echo.storage.set(
    "state", nextState, documentState.revision
  );
  // 只有 Promise 成功后才能显示“已保存”。
}

async function removeState() {
  documentState = await window.echo.storage.delete("state", documentState.revision);
}
```

每个应用最多 1 MiB JSON、1000 个文档键（包含已删除文档的版本标记）。键为字母、数字开头，随后可含字母、数字、点、连字符和下划线，最多 128 字符。建议用少量文档存储业务列表，避免为每一次操作生成新键。

写入必须携带读取时的 revision；成功返回递增后的 revision。出现 `error.code === 409` 表示另一窗口更新过数据，提示用户重新读取、比较或合并，不自动用旧内容覆盖。删除后版本仍递增，旧窗口不能重新覆盖新数据。

数据按部署记录中的所属租户、用户和应用 ID 隔离。更新应用保持 ID，数据可继续使用；改变 ID 会建立新数据空间。不用于保存 API key、登录口令等凭据。宿主数据目录不可用或 JSON 损坏时会报错，不把它当空数据覆盖。

## AI、技能和插件任务

在 `app.json` 声明 `"permissions": ["app.storage", "task.request"]`（不需要存储时可只声明 task.request）。

```js
const task = await window.echo.tasks.request({
  kind: "ai",
  prompt: "根据以下客户数据生成跟进建议：" + JSON.stringify(selectedCustomers)
});
// 用户确认后返回 { taskId, route, status, terminal: false, text: "" }。
// 确认前不执行；用户取消或确认超时会拒绝 Promise。
statusLabel.textContent = "正在分析…";
const result = await window.echo.tasks.wait(task.taskId);
// 只返回最终回答，不包含推理、工具日志或其他会话内容。
answer.textContent = result.text;
statusLabel.textContent = result.status === "completed" ? "分析完成" : "请检查任务结果：" + result.status;
```

技能请求使用 `{ kind: "skill", target: "技能ID", prompt: "任务描述" }`；插件请求使用 `{ kind: "plugin", target: "插件ID", prompt: "任务描述" }`。目标是请求使用的能力，不保证该能力已安装或启用，执行前由正常会话检查。每次请求的提示词最多 10000 字符。

宿主显示应用名称、能力类型、目标和完整任务描述。用户取消时 Promise 拒绝，应用保留当前数据；用户确认后创建独立任务会话，通过正常 Agent、工具权限和审批流程执行。应用上方显示状态、审批、停止和查看会话入口。不能在收到 taskId 时显示已完成。

`tasks.get(taskId)` 返回当前快照 `{ taskId, route, status, terminal, text, turnId?, truncated? }`。`tasks.wait(taskId)` 每 3 秒查询，最多等待 10 分钟，直到 `terminal` 为 true 返回；等待超时不会取消后台任务，应提示用户继续查看，不能自动重新提交。断线时保留任务并恢复状态，不把断线当作完成。一个应用窗口同一时间只执行一个任务，最多保留本窗口最近 20 个任务结果；不能传入其他应用或其他会话的 ID。

`completed` 才表示正常完成；`completed_with_warning`、`partial`、`blocked_on_user`、`paused`、`failed`、`cancelled`、`interrupted` 要分别提示，不自动重试。`connecting`、`running`、`awaiting_approval`、`reconnecting`、`recovery_error`、`unknown` 都不表示完成。`unknown` 表示发送状态不确定，前往会话检查，避免重复执行。

回答最多返回 65536 个字符，截断时 `truncated: true`，完整结果在会话中。应用应通过 textContent 或安全的 Markdown 渲染显示，不能将回答交给 innerHTML 或 eval。关闭应用后任务保留在会话，当前窗口的桥接句柄失效；需要保留已完成结果时，主动用 `echo.storage` 保存。此接口不允许指定自动批准、关闭沙箱、任意后台路径或宿主凭据。
