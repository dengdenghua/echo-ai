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
- `runtime/execution/tool_engine/executor.py:571`
- `runtime/execution/tool_engine/executor.py:574`
- `runtime/execution/tool_engine/executor.py:609`
- `runtime/execution/tool_engine/executor.py:612`
- `runtime/sensing/model_router/anthropic_router.py:220`
- `runtime/sensing/model_router/anthropic_router.py:231`
- `runtime/sensing/model_router/anthropic_router.py:525`
- `runtime/sensing/model_router/anthropic_router.py:530`

## `post_tool` · 1 处

- `runtime/execution/tool_engine/executor.py:1027`

## `pre_tool` · 1 处

- `runtime/execution/tool_engine/executor.py:432`

## `session_start` · 2 处

- `runtime/sensing/gateway/_realtime_turn_start_phases.py:165`
- `runtime/sensing/gateway/_realtime_turn_start_phases.py:173`

## `stop` · 2 处

- `runtime/sensing/gateway/_realtime_turn_reporting.py:146`
- `runtime/sensing/gateway/_realtime_turn_reporting.py:153`

## `user_prompt` · 2 处

- `runtime/sensing/gateway/_realtime_turn_start_phases.py:166`
- `runtime/sensing/gateway/_realtime_turn_start_phases.py:175`

