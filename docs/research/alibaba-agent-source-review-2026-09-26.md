# 阿里开源 Agent 与 Echo 三端接入评估

核查日期：2026-09-26。结论来自官方仓库、16 个选定源文件/服务文档以及 Echo 当前源码的静态对照。未运行第三方代码、调用付费模型或创建云资源；本文的集成方案与验收条件尚未实施。

Echo 基线：OS `a2443d91`，AI `b671ff6`，Mobile `9864dfc`。仓库另有未提交开发；下文明确区分已提交模块与未提交入口。上游选定文件及元数据缓存位于 `E:/echo mobile/build/alibaba-agent-audit/`，版本清单为 `sources.json`。

## 结论与优先级

保留 Echo 的设备协议、身份授权、任务检查点与传输回执。优先把现有手机/浏览器的反馈循环接入共享任务，再通过设备适配器接云电脑和云手机。个人记忆适合独立服务接入；QwenPaw 的任务和文件体验适合作为产品与实现参考。

| 顺序 | 工作 | 主要项目 | 涉及 Echo 仓库 | 相对复杂度 |
|---|---|---|---|---|
| P0 | 统一观察、行动、结果核验与未知结果状态 | Mobile-Agent 思路 + Echo 现有 ReAct | AI、OS 为主，Mobile 执行和回执 | 高：动态计划与审批语义需要一起处理 |
| P0 | 为单设备任务增加父任务、跨设备子任务和文件交接 | Echo 现有任务/执行节点体系 | AI、OS 为主，Mobile 展示接续 | 高：恢复、幂等和交付物身份 |
| P1 | 将自建沙箱作为执行目标纳入设备中心 | OpenSandbox | OS、AI | 中高：生命周期、能力注册、文件和画面适配 |
| P1 | 云电脑、云手机服务适配器 | AgentBay SDK | OS、AI；Mobile 使用共同入口 | 中高：账号、镜像能力、资源释放与实测 |
| P2 | 个人记忆检索与整理适配 | ReMe | AI 主接，OS 托管，Mobile 经网关访问 | 中：接口、用户隔离、删除语义 |
| P2 | 网页内操作后端试验 | Page Agent | AI 浏览器工具、OS 网页工作台 | 中：元素定位与异步桥接 |
| P3 | 工作区快照与恢复预览 | QwenPaw | AI、OS | 中高：文件恢复和外部动作不能混淆 |

复杂度为源码评估，不是工期承诺。没有同环境任务实测，不给成功率或竞品总分。

## Echo 已有能力与真实缺口

### 已有且应复用

- OS/AI 的 `runtime/tentacle/base.py` 定义设备身份、动态能力、`ToolCall`、`ToolResult` 和连接/执行接口；云执行目标可以实现此协议。
- 两仓库的 `runtime/tentacle/task_workspace.py` 和 `procedure.py` 已具备持久任务、计划审批、暂停恢复、步骤检查点和结果记录。
- `runtime/tentacle/transfer_journal.py` 已处理传输回执与恢复；接入云文件时应沿用同一用户可见的传输状态。
- AI 的 `runtime/execution/suckers/browser_backend.py` 已有统一浏览器后端协议；`runtime/core/cerebrum/react_browser_iteration.py` 已有浏览器 ReAct 循环相关控制。
- OS/AI 的 `runtime/memory/provider.py` 已有可插拔接口，`container_sandbox.py` 已有按线程运行的 Docker 执行封装。
- Mobile 的 `LightweightReAct.kt` 已有工具反馈、步数限制、循环检测及可选目标校验；`ToolRegistry.kt`、`ToolRegistryMcpProvider.kt` 已有手机工具执行入口。不能把 Echo 描述为完全没有反馈循环或手机操作能力。

### 本次确认的缺口

1. **共享任务路径为预先生成步骤。** `TaskWorkspace._plan()` 调用决策器得到列表，随后 `_run()` 执行 Procedure；这一入口没有每步截图后继续生成下一步的逻辑。AI 和 Mobile 其他路径已有循环，需要接通并复用。
2. **一个共享任务只操作一个目标设备。** `_plan()` 明确拒绝与 `record["device_id"]` 不同的调用。手机提交电脑任务已支持，但“电脑生成文件 → 手机打开文件”仍需要父任务协调多个子任务。
3. **手机目标校验把部分未知状态当作成功。** `GoalVerifier.kt` 的 `verify()` 在没有截图、没有 VLM 或捕获异常时返回 `achieved=true`；`parse()` 对不明确回答也默认放行。这是代码路径发现，未做运行复现。应改为 `achieved / not_achieved / unverified`，不能把缺乏证据直接呈现为核验成功。
4. **记忆接口不能直接套上语义检索。** `MemoryProvider.recall()` 目前主要按 session/event/limit 取记录，没有 query 参数。ReMe 搜索应先用独立异步检索接口或 MCP 工具接入，避免把网络请求塞进同步日志接口。
5. **当前工作树已有另一路执行节点开发。** AI 的 `runtime/sensing/gateway/execution_nodes_router.py` 尚未跟踪，已出现任务分派、认领、文件摘要与结果提交结构。规划多设备编排时必须先与这项工作对齐；本轮没有编辑它，也没有将其当作已交付能力。

## 源码复用清单

### Mobile-Agent / GUI-Owl：复用观察与动作适配

版本 `11cea575561fb7800b5fb6b6cafa56f7a91de11f`；根 LICENSE：MIT。

已读 [mobile_use 主循环](https://github.com/X-PLUG/MobileAgent/blob/11cea575561fb7800b5fb6b6cafa56f7a91de11f/Mobile-Agent-v3.5/mobile_use/run_gui_owl_1_5_for_mobile.py) 和同目录 `utils.py`。主循环逐步截图、调用视觉模型、解析动作、执行并保存历史；支持点击、输入、滑动、打开应用、等待及请求用户介入。演示使用 ADB、模型服务和本地截图目录。

接入建议：AI 生成标准动作提案，OS 任务服务记录观察和审批，Mobile 沿用现有工具执行。映射模型动作到 `ToolCall`，保留工具名白名单、参数校验、屏幕尺寸/旋转转换和执行回执。实际 ADB 动作代码与 Kotlin 执行端不宜直接混用。

动态生成的动作必须拥有对应授权。现有 `exact_arguments` 只批准当前具体计划；新动作超出原计划时需要形成新 revision 或采用明确设计的有界授权，不能暗中沿用旧批准。

演示中的模型 `terminate` 或 `answer` 不能直接成为 Echo 的业务成功证明。接入后由观察证据、工具结果及目标核验共同决定完成状态。模型权重的条款和资源需求另行核查，根代码 LICENSE 不代表所有模型权重。

### OpenSandbox：复用沙箱 SDK 与服务端

版本 `f3950db2499e8d572694bf9939e4bf985a2eab8a`；根 LICENSE：Apache-2.0。

已读 [sandbox.py](https://github.com/opensandbox-group/OpenSandbox/blob/f3950db2499e8d572694bf9939e4bf985a2eab8a/sdks/sandbox/python/src/opensandbox/sandbox.py)。提供创建、重连、续期、暂停、恢复、快照以及命令/文件接口。

建议新增可选沙箱 provider，并包装成 Tentacle 设备；OS 负责实例生命周期和身份，AI 负责路由任务。需要持久化 provider、远端实例 ID、工作区、到期时间、支持能力。仅关闭窗口不应销毁任务环境。

源码明确区分：`close()` 清理客户端连接；`kill()` 终止远端实例；`destroy()` 执行终止与本地清理。必须在 Echo UI 和关闭流程中区分这些操作。

SDK 有方法不代表任意部署环境都支持同样的快照/暂停语义，仍需按服务端和运行时实测。它也不能直接替代完整 Android 云手机平台。

### AgentBay：复用云电脑与云手机 SDK

版本 `8e2fa8f20981c826eb5d247bc6701d52570e104a`；SDK 根 LICENSE：Apache-2.0。

已读 [session.py](https://github.com/agentbay-ai/wuying-agentbay-sdk/blob/8e2fa8f20981c826eb5d247bc6701d52570e104a/python/agentbay/_async/session.py)、[computer.py](https://github.com/agentbay-ai/wuying-agentbay-sdk/blob/8e2fa8f20981c826eb5d247bc6701d52570e104a/python/agentbay/_async/computer.py)、[mobile.py](https://github.com/agentbay-ai/wuying-agentbay-sdk/blob/8e2fa8f20981c826eb5d247bc6701d52570e104a/python/agentbay/_async/mobile.py) 和 `filesystem.py`。

可映射能力：桌面点击/键盘/截图；手机滑动/输入/界面元素/截图；文件上传下载；会话状态、保活、删除和连接链接。适合分别包装云桌面、云手机执行目标，并按镜像实际支持能力登记。

`get_link()` 返回连接 URL，不是我们当前 H.264/手机画面流协议。首轮可以评估服务商连接页面；嵌入 Echo 的“打开设备”和“悬浮小窗”前，还需核查链接权限、有效期、嵌入条件及画面传输支持，不能声称 SDK 接通即同屏完成。

SDK 需要 AgentBay 账号凭据与服务端。密钥保存在 OS/AI 服务侧；文件传输适配统一回执，不能仅以 HTTP 请求成功当作文件内容校验完成。

### ReMe：独立记忆服务优先

版本 `bebad3674573477ad294ca44eb15f508feea2665`；根 LICENSE：Apache-2.0。

已读 [服务文档](https://github.com/agentscope-ai/ReMe/blob/bebad3674573477ad294ca44eb15f508feea2665/docs/en/services.md)、`http_service.py` 和 `mcp_tools.py`。普通 Job 通过 HTTP 暴露，也可注册成 MCP 工具；流式 Job 不通过该 MCP 注册路径暴露。支持服务端注入不能被调用者覆盖的参数。

首轮只接搜索/读取，评估检索质量后再接 `auto_memory`。OS 托管，AI 通过受控服务访问，Mobile 使用同一 Echo 网关；用户/项目隔离由服务端绑定。

服务文档明确该服务默认本地使用、没有通用用户鉴权，并允许跨源请求；因此不能直接将其端口当三端公网记忆 API。Echo 网关应承担身份、作用域、暴露 Job 的范围及请求限制。

记忆仍是知识与偏好，执行事实继续以 Echo 的事件/任务回执为准。保持已有 `memory/semantics.py` 的来源标记。先做可选增强，避免破坏现有日志、检索和删除约定。

### Page Agent：接浏览器后端，保留现有工作台

版本 `9eb6b6646500264d9034dd466a4270cb9fc1ef1e`；根 LICENSE：MIT。

已读 [PageAgent.ts](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/packages/page-agent/src/PageAgent.ts)、[PageController.ts](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/packages/page-controller/src/PageController.ts) 和 `actions.ts`。完整 PageAgent 组合 core/controller/panel；Controller 提供 DOM 摘要、按索引点击/输入和滚动。

优先评估 Controller 的 DOM 观察/动作层，接入 Echo 已有 `BrowserBackend`，工作台仍使用 Echo 的任务卡片。Echo 当前接口用 selector，而上游 Controller 用元素 index；适配时必须绑定一次观察快照并处理页面变化，不能把旧 index 用到新页面。Python 同步接口与浏览器异步执行还需要桥接和超时管理。

Controller 另有执行 JavaScript 的方法；首轮映射只开放选定 DOM 操作，不自动把所有 Controller 方法注册给模型。它负责网页操作，不会自动获得本机原生应用或手机界面的操作权限。

### QwenPaw：参考快照与任务服务，按模块吸收

版本 `3822ec7173d17cf37c8a02f51d3ed5628079e86e`；根 LICENSE：Apache-2.0。

已读 [检查点模型](https://github.com/agentscope-ai/QwenPaw/blob/3822ec7173d17cf37c8a02f51d3ed5628079e86e/src/qwenpaw/checkpoints/models.py)、`checkpoints/service.py` 和 `app/crons/manager.py`。模型区分快照、恢复计划、恢复前快照和 dry-run；恢复可选择会话、记忆与文件。Cron 服务有持久仓库、暂停恢复、历史及并发锁相关处理。

最值得吸收的是“恢复前展示会改变哪些文件”和“任务历史能回看”的交互及状态模型。此处检查点包含文件/会话恢复，与 Echo 当前设备步骤恢复并不相同；恢复文件不能撤回已经在手机或外部应用完成的操作。

AgentScope/AgentTeams 本轮保持上一轮的官方文档级调研，未扩大为源代码审计。现阶段不建议直接替换 Echo 的任务主控框架；先核实新增模块能解决的具体缺口。

## 三端职责与任务流

建议架构：三个客户端 → Echo 身份与任务服务 → 任务协调器 → 本地设备 / 手机 / OpenSandbox / AgentBay 适配器。ReMe 作为受控记忆服务提供检索；Page Agent 或 GUI-Owl 作为可选观察/决策能力加入现有执行路径。

- AI：任务理解、逐步规划、工具和 GUI 的选择、结果核验、记忆检索。
- OS：设备与云会话登记、生命周期、远程连接、任务持久化、授权、传输和小窗入口。
- Mobile：手机本地执行、截图/UI 树、远程任务入口、人工接管及结果查看。
- 父任务记录跨设备依赖；每个子任务继续遵守现有单设备 Procedure。交接文件用带 SHA-256、来源和目标的 artifact manifest，避免模型猜测另一台设备上的文件路径。
- 云沙箱、用户电脑和手机应显示各自明确身份与实际能力；设备掉线或链接过期按事实呈现状态。

## 分阶段验收：以下尚未执行

1. **本机反馈任务**：在可控测试 App 中完成输入和保存；中途弹窗出现后能重新观察；没有核验证据时显示“结果待核验”。保持现有暂停/断线未知结果处理。
2. **跨设备交接**：电脑生成测试文件 → SHA 校验 → 手机接收并打开；父任务显示两个子任务和真实产物，重复投递不产生重复文件或重复副作用。
3. **自建沙箱**：创建 → 注册设备 → 执行 → 文件回传 → 重连 → 明确释放；关闭客户端后按配置继续任务，服务器重启后能识别原实例。
4. **云电脑/手机**：重复上述流程并验证会话过期、配额错误、执行超时；另行验证画面链接、控制权与用户接管，不能用 SDK 单元测试替代。
5. **记忆和网页**：多用户/项目数据不串用；重复写入与删除结果准确；网页状态变化后旧元素索引失效；用户取消后不再下发后续操作。

统一记录每组固定任务的实际完成率、耗时、模型/云资源成本、人工介入次数、未知结果比例和恢复成功率，再与现有 Echo 路径对比。应先有真实测量，再决定扩大依赖或对外宣称领先。

最初评估阶段仅交付本文档；当时未改动业务代码或安装依赖。后续实施状态见下节。


## 后续实施进度（2026-09-26）

| 项目 | 已落地范围 | 尚待完成 |
| --- | --- | --- |
| 结果核验 | Mobile 三态核验；三端持久化人工核对；未核验不进入成功缓存 | 实体设备上的任务成功率验证、更多非视觉证据 |
| 多设备父任务 | AI/OS 协调 2–8 个有序阶段；三端入口；阶段回执交接；独立检查点、重启接续与逐阶段审批 | 自动目标拆解、并行依赖图、带 SHA-256 的跨阶段产物清单及真实文件交接验收 |
| 共享反馈循环 | 下一阶段规划使用前序实际结果与用户核对记录 | 逐 GUI 动作的动态观察、规划调整与自动核验循环 |
| OpenSandbox / AgentBay / ReMe / Page Agent | 本文源码评估 | 尚未安装或接入 |
| QwenPaw 文件快照与恢复预览 | 本文源码评估 | 尚未实现 |

实施与验证细节见 `docs/device-interconnect.md` 和 Mobile 的 `UNIFIED_INTERCONNECT_ACCEPTANCE.md`。各设备需连接同一个设备中心；未部署公网云服务。
