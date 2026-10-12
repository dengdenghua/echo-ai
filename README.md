# Echo AI

> v0.1.0 · Apache-2.0

Echo AI 是 Echo 家族的**桌面 AI 工作端**。本仓库同时包含共享的 Agent 运行时 —— 以 `runtime/` 里的 Python 运行时为核心，跑通「规划 → 执行 → 观察 → 记忆 → 改进」的完整闭环：支持工具调用、记忆反思、安全治理、浏览器/桌面控制与自改进循环。

> 命名口径：品牌名 **Echo**；PyPI 发行名 `echo-ai-runtime`（`pip install echo-ai-runtime`）；运行时入口为 `python -m runtime`，导入包名始终是 `runtime`。

IDE、浏览器、桌面应用与扩展只是产品表层；核心产品是 `runtime/`。

English readers: [README.en.md](README.en.md)

## Echo 三端定位

| 产品 | 定位 | 使用与运行场景 |
| --- | --- | --- |
| [Echo AI](https://github.com/dengdenghua/echo-ai) | 桌面 AI 工作端 | 面向本机文件、代码、应用和工具的深入工作；交互体验参考 Codex 桌面端。 |
| [Echo Mobile](https://github.com/dengdenghua/echo-mobile) | 手机 AI 入口 | 面向随身对话、语音沟通、任务发起和结果查看；交互体验参考手机上的 GPT 对话。 |
| [Echo OS](https://github.com/dengdenghua/echo-os) | 私人云常驻执行环境 | 部署在用户自己的服务器、NAS 或私有虚拟机上，承载后台任务、浏览器与计算环境；运行形态参考 Dot 的云端电脑。 |

这是三端的产品定位与协作方向，不代表所有跨端功能已经实现。桌面端可以本机执行；手机端和桌面端也可以连接私人云执行任务。助手和白幽灵小队属于执行成员，执行节点属于运行环境，两者不绑定为一对一关系。三端协作围绕统一身份、项目、任务与执行节点展开，具体实现状态以各仓库文档为准。

## 快速开始

```bash
# 最小确定性后端演示，无需 LLM key
pip install -e ".[minimal]"
python -m runtime bugfix-demo

# 开发环境（测试、FastAPI UI、web skills）
pip install -e ".[dev,serve,web]"
python -m runtime quickstart --non-interactive
python -m runtime status
python -m runtime ui --port 8310
```

打开 <http://127.0.0.1:8310>。

前端开发：

```bash
cd frontend
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

## 核心文档

先看这几份：

1. [10-minute golden path](docs/GOLDEN_PATH.md)
2. [Quickstart](QUICKSTART.md)
3. [Concepts](docs/CONCEPTS.md)
4. [Architecture](docs/guide/architecture.md)
5. [Office、PDF 与 HTML 产物协作](docs/guide/office-and-html-artifacts.md)
6. [Main Path Audit](docs/archive/main-path-audit.md)
7. [Self-Evolution Minimum Loop](docs/archive/react-self-evolution.md)

## 当前结构

| 路径 | 作用 |
|---|---|
| `runtime/` | 核心运行时：规划、执行、记忆、安全、UI API |
| `frontend/` | 工作区 UI 和桌面壳 |
| `tests/` | 回归、单元和集成测试 |
| `agents/` | agent 定义、preset 和元数据 |
| `skills/` | 可调用技能和技能元数据 |
| `protocols/` | 协议资产 |
| `prompts/` | prompt 模板和变体资产 |
| `extensions/` | 随运行时一起发布的扩展 |
| `tools/` | 开发工具 |
| `scripts/` | 项目自动化脚本 |
| `docs/` | 架构、入门、审计和参考文档 |

历史资料请从 [docs/archive/README.md](docs/archive/README.md) 进入。

## License

Apache-2.0，见 [LICENSE](LICENSE)。
