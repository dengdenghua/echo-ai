---
type: "Graph"
title: "Hook surface"
description: "每个 lifecycle-hook 的 dispatch 调用点 · 社区 handler 通过 `@register_hook(EventType)` 订阅。"
tags: ["hooks"]
tier: "standard"
---
# Hook surface

> 每个 lifecycle-hook 的 dispatch 调用点 · 社区 handler 通过 `@register_hook(EventType)` 订阅。

## `notification` · 10 处

- `runtime/execution/suckers/plan_mode.py:205`
- `runtime/execution/tool_engine/_executor_helpers.py:869`
- `runtime/execution/tool_engine/executor.py:537`
- `runtime/execution/tool_engine/executor.py:540`
- `runtime/execution/tool_engine/executor.py:575`
- `runtime/execution/tool_engine/executor.py:578`
- `runtime/sensing/model_router/anthropic_router.py:220`
- `runtime/sensing/model_router/anthropic_router.py:231`
- `runtime/sensing/model_router/anthropic_router.py:525`
- `runtime/sensing/model_router/anthropic_router.py:530`

## `post_tool` · 1 处

- `runtime/execution/tool_engine/executor.py:1039`

## `pre_tool` · 1 处

- `runtime/execution/tool_engine/executor.py:649`

## `session_start` · 2 处

- `runtime/sensing/gateway/realtime_turn_lifecycle.py:720`
- `runtime/sensing/gateway/realtime_turn_lifecycle.py:728`

## `stop` · 2 处

- `runtime/sensing/gateway/realtime_turn_lifecycle.py:257`
- `runtime/sensing/gateway/realtime_turn_lifecycle.py:264`

## `user_prompt` · 2 处

- `runtime/sensing/gateway/realtime_turn_lifecycle.py:721`
- `runtime/sensing/gateway/realtime_turn_lifecycle.py:730`

