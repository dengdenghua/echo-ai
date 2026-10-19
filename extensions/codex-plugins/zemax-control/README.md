# Zemax Control for Codex

本地 Codex 插件：Skill + 32 个 MCP 工具，通过官方 ZOS-API 操作 OpticStudio。

## 使用

安装插件后新建一个任务，输入：

> 使用 Zemax 插件检查环境，并连接当前 OpticStudio，列出当前镜头参数。

实时连接前，在 OpticStudio 点击 Programming > Interactive Extension。
MCP 启动和工具发现不需要 Zemax；实际建模、分析和优化需要本机安装及有效的 API 许可证。
没有打包 Zemax 本体、许可证、DLL 或玻璃目录。

## 本机运行环境

独立 Python 环境：`C:\Users\Administrator\.codex\runtimes\zemax-control`。
`.mcp.json` 使用本机绝对路径，服务器代码来自此插件的源目录。
移动目录或分享给另一台机器后，需要重新配置运行环境，不能直接复用这些路径。

在安装了 Python 的目标 Windows 机器上：

```powershell
python -m venv "$env:USERPROFILE\.codex\runtimes\zemax-control"
& "$env:USERPROFILE\.codex\runtimes\zemax-control\Scripts\python.exe" -m pip install -r requirements-lock.txt
& "$env:USERPROFILE\.codex\runtimes\zemax-control\Scripts\python.exe" scripts/configure.py
```

如果注册表未登记 Zemax 数据目录，可向 configure.py 添加 `--zemax-root '实际数据目录'`。
配置完成后从个人插件市场重新安装插件，并在新任务中使用。

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
