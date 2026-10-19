---
type: "BackendIndex"
title: "后端架构 · Backend"
description: "Python runtime · 分 6 个子系统 · 左侧树展开看每个子系统详情。"
tags: ["backend"]
tier: "standard"
---
# 后端架构 · Backend

> Python runtime · 分 6 个子系统 · 左侧树展开看每个子系统详情。

| 子系统 | 目录 | 职责 |
| --- | --- | --- |
| Runtime 核心 | `runtime/execution/`, `runtime/core/` | 执行器 · 规划 · 技能注册 · 心跳 |
| Safety | `runtime/safety/` | 宪法 · 免疫 · 生命周期 hooks |
| Memory | `runtime/memory/` | Journal (genome) · Context (hemolymph) |
| Sensing | `runtime/sensing/` | Eyes (model router) · Siphon (HTTP API) |
| Adapters | `runtime/adapters/` | MCP · Channels · 第三方集成 |
| Agents | `agents/` | 预置 agent 的 profile / memory / workspace |

## 依赖关系（自动计算）

每个子系统被**多少**子系统引用 · 静态 AST 扫描 ``from runtime.X ...`` 语句得出。
前端 Wiki 面板会把下面的 ```mermaid``` 渲染成真图。

```mermaid
graph LR
  execution[execution]
  core[core]
  safety[safety]
  memory[memory]
  sensing[sensing]
  adapters[adapters]
  platform[platform]
  sensing -- 227 --> platform
  sensing -- 181 --> safety
  execution -- 172 --> platform
  sensing -- 137 --> execution
  sensing -- 126 --> memory
  safety -- 116 --> platform
  execution -- 102 --> safety
  memory -- 77 --> platform
  sensing -- 69 --> protocol
  core -- 60 --> platform
  platform -- 56 --> execution
  platform -- 55 --> safety
  sensing -- 54 --> projectos
  sensing -- 46 --> core
  sensing -- 38 --> adapters
  execution -- 35 --> memory
  core -- 31 --> safety
  core -- 29 --> execution
  platform -- 24 --> sensing
  execution -- 21 --> core
  memory -- 19 --> safety
  sensing -- 18 --> workspace
  projectos -- 17 --> platform
  safety -- 17 --> execution
  safety -- 16 --> memory
  platform -- 15 --> memory
  core -- 14 --> memory
  safety -- 14 --> adapters
  adapters -- 13 --> platform
  platform -- 13 --> adapters
  platform -- 13 --> core
  projectos -- 13 --> safety
  adapters -- 11 --> safety
  tentacle -- 10 --> platform
  execution -- 9 --> adapters
  memory -- 8 --> execution
  projectos -- 8 --> execution
  memory -- 7 --> protocol
  safety -- 7 --> core
  workspace -- 7 --> platform
  _cli_commands.py -- 6 --> platform
  platform -- 6 --> projectos
  _cli_commands.py -- 5 --> memory
  cli_serve.py -- 5 --> adapters
  core -- 5 --> adapters
  memory -- 5 --> core
  platform -- 5 --> tentacle
  adapters -- 4 --> sensing
  cli_core.py -- 4 --> execution
  cli_execution.py -- 4 --> execution
  cli_run.py -- 4 --> execution
  cli_serve.py -- 4 --> platform
  execution -- 4 --> protocol
  research -- 4 --> platform
  cli.py -- 3 --> platform
  cli_core.py -- 3 --> core
  cli_project.py -- 3 --> projectos
  cli_reflect.py -- 3 --> platform
  cli_run.py -- 3 --> platform
  cli_serve.py -- 3 --> execution
  cli_serve.py -- 3 --> safety
  evals -- 3 --> execution
  execution -- 3 --> sensing
  platform -- 3 --> cli
  projectos -- 3 --> memory
  tentacle -- 3 --> safety
  tour.py -- 3 --> core
  tour.py -- 3 --> safety
  workspace -- 3 --> safety
```

