# LightTools 本地控制

个人 Codex 插件，包含 LightTools LTAPI4/COM MCP 和 `lighttools-control` Skill。它是本机自建集成，使用软件厂商的官方 API。

## 使用

在插件目录的 **Personal** 来源中启用 **LightTools 本地控制**，然后在新聊天中输入光学任务，或调用 `$lighttools-control:lighttools-control`。

例如：

- 检查本机 LightTools 环境并连接当前模型。
- 检查光源和接收器设置，执行照明追迹并导出网格 CSV。
- 根据尺寸和材料要求建立光学模型，保存为新的 `.lts` 文件。

插件提供 18 个工具：环境查询、启动/连接、任务状态、模型新建/打开/保存、参数读写、对象/字段查询、建模命令、追迹、接收器网格、CSV 导出以及本机官方文档搜索和读取。`lt_read_object_fields` 在原生列表仍有效时批量读取字段，保留逐字段 API 状态，可选与字符串路径对照；同名对象路径可能有歧义。当前尚未包装优化求解器、GPU 专用设置和高级 JumpStart。

先查询会话并连接明确的 PID，后续操作使用返回的活动视图。COM 任务返回 `job_id`，仅 `completed` 表示完成。新建或打开模型会先保存恢复副本；输出文件不覆盖已有文件。模型长度使用当前单位，网格保留 LTAPI4 原始方向。

## 本机安装

插件源目录：`C:/Users/Administrator/plugins/lighttools-control`。

个人市场：`C:/Users/Administrator/.agents/plugins/marketplace.json`。安装标识：`lighttools-control@personal`。

插件包含 MCP 源码与 Skill，独立 Python 环境位于 `C:/Users/Administrator/.codex/runtimes/lighttools-control`。安装需要 Windows、LightTools 和可用许可证。MCP 启动不会自动启动 LightTools 或修改模型。

此包的 MCP 配置针对当前机器。换到另一台机器时，需要在该机器建立 Python 环境、安装 `requirements.lock` 和本插件包，并调整 `.mcp.json` 的 Python、插件目录和 LightTools 安装路径。

更新本机插件源文件后，可重新安装：

```powershell
codex plugin add lighttools-control@personal
```

然后刷新插件连接或启动新聊天。安装副本由 Codex 缓存管理，源码目录保留作本机维护使用。

## 许可证报错

本机先前的 Core 报错由已配置的许可证服务停止引起。启动服务后，许可证端口、Core 签出和 LTAPI4 连接恢复正常。再次出现相同报错时，先检查服务与配置的许可证地址。

在具备管理员权限的 PowerShell 中检查并启动原服务：

```powershell
Get-Service -Name 'agileesofd License Server'
Start-Service -Name 'agileesofd License Server'
```

许可证环境变量通过 `env_vars` 转发，不在包中保存许可证文件或密钥。插件不会自动改动许可证配置或反复启动应用。

## 验证和维护

原集成已实测建模、追迹、8×5 网格与 40 个逐单元读数一致、CSV 导出以及 `.lts` 保存/重开。插件迁移会另行验证工具发现、官方文档查询、当前模型连接和单位读取。

任务记录及恢复副本位于插件源目录的 `logs/`、`recovery/`。这些运行数据和 Python 环境不包含在分发 ZIP 中。升级或迁移前请保留需要的模型副本。

包使用当前客户端支持的 `.codex-plugin/plugin.json` / `.mcp.json` 格式。个人市场安装方式依据 [OpenAI 官方插件说明](https://developers.openai.com/plugins/build/plugins)。
