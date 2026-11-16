# SolidWorks 本地控制插件

已实现 36 个 MCP 工具：文档检查与导出、装配干涉及配合检查、依赖打包与副本替换、声明式建模、以及已有 Flow 项目的检查、备份求解、结果读取和 HTML/CSV/JSON/视图导出。全部操作经由同一套持久化串行作业队列（`D:\AI\SolidWorksMCP\jobs.py`）执行。

## 作业契约

每个 CAD 工具返回 `job_id` 并机器级串行。轮询 `sw_job_status`；返回 `submitted` 不代表模型已生成。读取嵌套结果：状态、错误、警告和实际测量几何。`completed` 且 `verified: false` 不是成功。超时不重试、不手工删锁；陈旧工作进程只能通过 `sw_acknowledge_dead_job` 释放，且要在无 SW/导入进程残留之后。原生输入默认只读打开，输出与副本必须给出新的绝对路径，已存在的文件不覆盖。

## 声明式建模（本版新增）

- `sw_create_part(plan, output_path)`：按毫米 JSON 计划新建零件并在保存前验证。草图实体支持 `line`、`rectangle`、`corner_rectangle`、`circle`、`arc`、`polygon`、`slot`、`spline`；特征支持 `extrude_boss`、`extrude_cut`、`extrude_midplane`、`fillet`、`chamfer`、`shell`。圆角/倒角/抽壳接受 `"all"`、`"none"` 或 `[{"point": [x, y, z]}]` 点选（毫米，自动取最近边/面）。
- `verify` 块与实测体积、实体数比对。未提供 `verify` 时几何仍被测量，但 `verified` 保持 false。建议给出可解析算的体积而非自指期望。
- 计划失败会丢弃自己创建的未保存草图文档，不留下半成品，也不写文件。
- `sw_create_assembly(plan, output_path)`：按毫米偏移加入组件、施加 `coincident`/`concentric`/`distance`/`parallel` 配合后保存。此处不读配合错误码，保存后需用 `sw_mate_status` 和 `sw_interference` 复核。
- `sw_create_drawing(plan, output_path)`：由既有模型生成标准或命名视图、注释，可选导出 PDF。
- 详细计划格式见 `skills/solidworks-control/references/modeling-plan.md`。

### 本机实测不支持（工具会明确拒绝，不会伪造）

在 SOLIDWORKS 2026 SP3.2 / COM revision 34.3.2 上实测：`linear_pattern`、`circular_pattern`、`mirror_feature` 的 API 返回 `False`、不改变任何几何、也不报错。因此工具直接抛错并指出替代做法，而不是输出一个悄悄缺少阵列的零件。

替代做法：把需要阵列或镜像的所有实体放进**同一个草图**。已验证三孔阵列与四孔板的体积与解析值完全一致。`arc`/`spline` 可正常画草图，但由它们构成的封闭轮廓未通过拉伸验证；请改用 `circle`/`slot`/`polygon`/`corner_rectangle`，或显式多段 `line` 闭环。`hole_wizard` 在本地辅助库中是空实现，未在此暴露。

### 验证证据

`C:\Users\Administrator\Documents\SolidWorks-AI\mcp-model-test-20260921\`：14 项用例 11 项通过、0 重建错误，体积与解析值一致（如 120x80x10 板 + 四个 ø6 通孔 = `94869.02665`，解析值 `94869.02664`；60x40x20 壁厚 2 封闭抽壳 = `15744.0`；六边形 r20 拉伸 10 = `10392.30485`）。未通过的三项是 `arc` 封闭轮廓、`mirror_feature`、`linear_pattern`，已在上文说明。

## Flow 仿真

求解工具要求已有正确配置的仿真项目，明确指定文档、项目名称、结果目录和新备份目录。求解前保存整个模型目录的磁盘副本；未保存的内存修改不会自动写入副本。作业完成、求解器成功、目标收敛是三个独立状态。

当前边界：尚不自动创建完整物理设置或云图，不自动修复装配配合，也未验证 Electronics/HVAC 扩展许可。不能把算例收敛视为用户整机热设计已验证。

## 运行环境

本机插件，包含 MCP 配置及操作 Skill。运行环境仍是 `D:\AI\SolidWorksMCP`，需 Windows、已安装的 SolidWorks 及该目录下 Python 环境。源码：`server.py`（MCP 接口）、`worker.py`（COM 派发）、`model_tools.py`（声明式建模）、`jobs.py`（持久化单写者队列）。插件缓存不存放 CAD 作业或用户模型。

`test_reliability.py` 验证元数据写入重试、历史结果备份、旧结果防误判和禁止覆盖；`validate_flow_tools.py` 通过真实 MCP 协议验证本机 Flow 结果读取；`validate_plugin_protocol.py` 验证插件加载后的工具数量与协议。

通过个人插件市场安装：`codex plugin add solidworks-control@personal`。新任务加载插件 Skill 与 MCP；已打开的会话需要重启（或新开任务）才会看到新增的建模工具。已核验本机 `config.toml` 的 `[mcp_servers]` 中没有独立的 solidworks 条目，插件 `.mcp.json` 是唯一来源，不会重复暴露工具。

这一版通过 MCP 连接已有运行环境，不含 SolidWorks 安装程序。分享插件不会自动安装另一台电脑的运行环境；先按目标机器调整 `.mcp.json` 与运行环境配置。插件为机器特定，不是可移植的 SolidWorks 安装包。

卸载插件不会删除 D 盘环境、作业日志或模型。源文件位于用户 plugins/solidworks-control；源码及环境说明见 D:\AI\SolidWorksMCP\README.md。上游项目对比见 skills/solidworks-control/references/upstream-research.md。