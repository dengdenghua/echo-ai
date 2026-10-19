# 巨型文件拆分工单（2026-10-19 三次更新：runtime 14 / frontend 34）

> 已出列 27 个（托管 75 → 48）：frontend model-picker.tsx、agent-world-api.ts、
> studio-panels.tsx（→studio-dialogs.tsx）；runtime cli_serve、realtime_turn_outcome、
> react_final_answer_guards、react_loop、_realtime_react_stream_drive、realtime_turn_input、
> context_steward、ephemeral_agents、openai_router、multi_agent_benchmark、web_skills、
> candidate_patch、group_store（→group_store_support）、capability_registry（→_connector_icons）、
> codex_backend/client（→client_support + client_account_api 组合委托）、
> kimi_compat_skills（→kimi_media_skills）、quote_hub（→quote_hub_support）、
> collaboration_collectors（→collaboration_collector_tasks，Lifecycle mixin 继承 StoreMixin）、
> sandbox（→sandbox_backends）、ephemeral_runner（→ephemeral_runner_support）、
> journal（→_journal_support + _jsonl_journal_redaction + _jsonl_journal_streams；顺删死基类 196 行）、
> cloud_catalog 3079→929（→_cloud_catalog_support + install/skills/transactions/validation 四 mixin）。

> 工具：`.workbuddy/split_god_file.py` + `restore_facade.py` + `retarget_patches.py`。

## 配方

1. 离 1000 最近 + 有测试 + 不在途；runtime 走自动拆，frontend 按注释/导出簇手工划界。
2. 再导出保 import 点；`ClassDef.lineno` 不含装饰器；条件导入块跟函数走。
3. monkeypatch 深耦合（design_studio_router 型）与单函数巨块（react_model_stream 型）不自动拆。
4. 每个拆完：tsc/eslint 或 ruff → 定向测试 → `god_file_check --strict` 删 SHRUNK 行 → 27/27。
5. mixin 抽方法簇时 mypy 会报 erased-self [misc] → 用组合委托 + Protocol（client_account_api 模式）。
6. ruff isort 默认 combine-as-imports=false：再导出用冗余 `as` 会被拆成每名一条语句（膨胀行数）；
   名字在主文件内有引用就直接普通 import，别加防御性别名。

## runtime（14 个）

| 行数 | 路径 | 备注 |
|---:|---|---|
| 1165 | `runtime/core/cerebrum/react_model_stream.py`  |
| 1165 | `runtime/core/cerebrum/react_model_stream.py`  |
| 1257 | `runtime/execution/tool_engine/executor.py`  |
| 1277 | `runtime/platform/ui/browser_router.py`  |
| 1287 | `runtime/sensing/gateway/agent_world_router.py`  |
| 1404 | `runtime/platform/plugins/plugin_hub.py`  |
| 1419 | `runtime/execution/subagents/sessions.py`  |
| 1448 | `runtime/core/cerebrum/_react_execution_phase6d.py`  |
| 1468 | `runtime/execution/codex_backend/responses_proxy.py`  |
| 1478 | `runtime/memory/cowork/collaboration_store.py`  |
| 1516 | `runtime/sensing/gateway/realtime_event_bridge.py`  |
| 1526 | `runtime/platform/plugins/bundled/paper_trading/__init__.py`  |
| 1558 | `runtime/sensing/gateway/design_studio_router.py`  |
| 1774 | `runtime/platform/plugins/bundled/narrative_studio/store.py`  |
| 1794 | `runtime/sensing/gateway/_team_stream_group_fanout.py`  |

## frontend（34 个）

| 行数 | 路径 | 备注 |
|---:|---|---|
| 1006 | `frontend/src/components/workspace/agents/agent-world-unified.tsx`  |
| 1095 | `frontend/src/components/store/cloud-skills-panel.tsx`  |
| 1149 | `frontend/src/core/realtime/client.test.ts`  |
| 1218 | `frontend/src/components/workspace/messages/message-output-summary.test.tsx`  |
| 1254 | `frontend/src/app/desktop/page.tsx`  |
| 1262 | `frontend/src/components/workspace/coder-engine-control.test.tsx`  |
| 1274 | `frontend/src/components/store/capability-market-panel.test.tsx`  |
| 1297 | `frontend/src/components/workspace/settings/model-settings-page.test.tsx`  |
| 1335 | `frontend/src/core/messages/utils.test.ts`  |
| 1429 | `frontend/src/app/browser/page.tsx`  |
| 1547 | `frontend/src/components/workspace/knowledge-graph-view.tsx`  |
| 1565 | `frontend/src/components/workspace/intelligence-panel.tsx`  |
| 1602 | `frontend/src/app/workspace/narrative/page.tsx`  |
| 1768 | `frontend/src/app/workspace/realtime/[thread_id]/page.tsx`  |
| 1868 | `frontend/src/components/browser/assistant-panel.tsx`  |
| 1946 | `frontend/src/app/workspace/design/director-stage.tsx`  |
| 1948 | `frontend/src/core/threads/realtime-adapter.test.ts`  |
| 2042 | `frontend/src/core/realtime/reducer.test.ts`  |
| 2045 | `frontend/src/components/workspace/agent-operator-panel.test.tsx`  |
| 2130 | `frontend/src/core/threads/use-thread-stream-realtime.ts`  |
| 2142 | `frontend/src/core/realtime/use-realtime-thread.ts`  |
| 2210 | `frontend/src/components/workspace/chat-input-box/ChatComposer.tsx`  |
| 2312 | `frontend/src/components/browser/url-bar.tsx`  |
| 2319 | `frontend/src/components/workspace/chat-input-box.test.tsx`  |
| 2485 | `frontend/src/components/browser/webview-tab.tsx`  |
| 2729 | `frontend/src/core/threads/use-thread-stream-realtime.test.ts`  |
| 2792 | `frontend/src/components/workspace/workspace-sidebar.tsx`  |
| 3127 | `frontend/src/core/realtime/use-realtime-thread.test.tsx`  |
| 3210 | `frontend/src/components/browser/browser-home.tsx`  |
| 3251 | `frontend/src/components/workspace/messages/message-list.process-trace.test.tsx`  |
| 3303 | `frontend/src/components/workspace/messages/message-group.tsx`  |
| 3304 | `frontend/src/components/workspace/messages/message-group.test.tsx`  |
| 3404 | `frontend/src/components/workspace/agent-workbench-panel.test.tsx`  |
| 7827 | `frontend/src/app/workspace/design/page.tsx`  |
