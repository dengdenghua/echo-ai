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
  sensing -- 214 --> platform
  execution -- 171 --> platform
  sensing -- 169 --> safety
  sensing -- 136 --> execution
  sensing -- 127 --> memory
  safety -- 102 --> platform
  execution -- 97 --> safety
  memory -- 80 --> platform
  sensing -- 64 --> protocol
  core -- 60 --> platform
  platform -- 56 --> execution
  platform -- 56 --> safety
  sensing -- 53 --> projectos
  sensing -- 42 --> core
  execution -- 40 --> memory
  sensing -- 38 --> adapters
  core -- 34 --> safety
  core -- 29 --> execution
  memory -- 26 --> safety
  platform -- 22 --> sensing
  safety -- 22 --> memory
  execution -- 21 --> core
  platform -- 18 --> memory
  projectos -- 16 --> platform
  safety -- 15 --> execution
  core -- 14 --> memory
  safety -- 14 --> adapters
  platform -- 13 --> core
  projectos -- 13 --> safety
  sensing -- 13 --> workspace
  adapters -- 12 --> platform
  platform -- 12 --> adapters
  adapters -- 11 --> safety
  memory -- 10 --> execution
  tentacle -- 10 --> platform
  execution -- 9 --> adapters
  projectos -- 8 --> execution
  memory -- 7 --> protocol
  safety -- 7 --> core
  _cli_commands.py -- 6 --> platform
  platform -- 6 --> projectos
  workspace -- 6 --> platform
  _cli_commands.py -- 5 --> memory
  cli_serve.py -- 5 --> adapters
  cli_serve.py -- 5 --> safety
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
  evals -- 3 --> execution
  execution -- 3 --> sensing
  platform -- 3 --> cli
  projectos -- 3 --> memory
  tentacle -- 3 --> safety
  tour.py -- 3 --> core
  tour.py -- 3 --> safety
```

