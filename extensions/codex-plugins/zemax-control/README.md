# Zemax Control for Echo

本地 Echo 插件：Skill + 32 个 MCP 工具，通过官方 ZOS-API 操作 OpticStudio。

## 使用

安装插件后新建一个任务，输入：

> 使用 Zemax 插件检查环境，并连接当前 OpticStudio，列出当前镜头参数。

实时连接前，在 OpticStudio 点击 Programming > Interactive Extension。
MCP 启动和工具发现不需要 Zemax；实际建模、分析和优化需要本机安装及有效的 API 许可证。
没有打包 Zemax 本体、许可证、DLL 或玻璃目录。

## 本机运行环境

由 Echo 仓库 `tools/install_personal_cad_plugins.py` 安装。服务器与技能位于
`<ECHO_HOME>/data/plugins/codex/zemax-control`；独立 Python 环境位于
`<ECHO_HOME>/runtimes/zemax-control`，无需 Codex 安装目录。

先创建该 Python 环境，再用 uv 或 pip 安装本包 `requirements-lock.txt`。
源包的 `.mcp.json` 是相对路径模板，安装器会生成本机绝对路径并保留 600 秒工具超时。
实际命令、回滚和验收方法见 Echo 仓库 `docs/guide/personal-cad-plugins.md`。

## 能力与限制

提供镜头表面编辑、视场/波长/光阑设置、评价函数、优化、光斑、分析曲线、多重结构、公差及非序列追迹/探测器数据工具。
`zemax_eval` 支持高级 ZOS-API Python 操作，具有普通本地 Python 的执行能力。
部分工具调用依赖具体 OpticStudio 版本；上游的测试声明不等于本机实测。
长时间优化超过客户端超时后，应检查任务状态，避免直接重复提交。

## 来源及改动

MCP 基于 webworn/zemax-mcp-server，固定提交 `3797d97492723f385988d47f8b183479bc172dd0`。
原始 README 保存于 UPSTREAM-README.md；其中声明 MIT，源提交未提供独立 LICENSE 文件。
本地新增：插件清单、Skill、启动/配置脚本、环境诊断；修复断开时 save=True 不保存的问题，并提前校验连接模式。

协议测试：`python scripts/test_protocol.py`，不启动 Zemax、不修改镜头。
测试记录见 validation.json。
