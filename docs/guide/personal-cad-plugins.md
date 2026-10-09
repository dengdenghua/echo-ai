# 个人 CAD 插件迁移到 Echo

这四个插件来自用户自己制作的 Codex personal 插件。Echo 源包保存在
`extensions/codex-plugins/`，没有修改 Codex 的原插件。

| 插件 | Echo 版本 | MCP 服务 | 实测工具数 |
| --- | --- | --- | --- |
| SolidWorks | 0.2.0+echo.20260925 | solidworks_local | 36 |
| Blender | 0.1.0+echo.20260925 | blender_official | 26 |
| KiCad | 0.1.0+echo.20260925 | kicad | 9 |
| Zemax | 0.1.0+echo.20260925 | zemax | 32 |

## 本机安装

在 Echo 仓库根目录运行（PowerShell）：

```powershell
uv venv "$env:USERPROFILE/.echo/runtimes/zemax-control" --python .venv/Scripts/python.exe
uv pip sync --python "$env:USERPROFILE/.echo/runtimes/zemax-control/Scripts/python.exe" extensions/codex-plugins/zemax-control/requirements-lock.txt
.venv/Scripts/python.exe tools/install_personal_cad_plugins.py --config config.local.yaml --apply
```

已经存在的 Zemax 环境无需重新创建。安装器先验证四个服务均能启动并列出工具，再通过 Echo
插件生命周期升级安装，记录每个服务的准确工具清单授权，并合并启动配置。重复运行相同版本和内容不会再次升级；修改插件内容应先升级版本号。

当前 8310 服务使用项目 `data/`，对应安装目录是 `D:/echo-ai/data/plugins/codex/`。
Zemax 服务代码在安装包内，Python 环境在 `~/.echo/runtimes/zemax-control/`，
不再引用 `.codex/runtimes` 或个人插件源码目录。安装器遵循 Echo 的路径规则：
显式 `ECHO_DATA_DIR` 优先，其次是 `<ECHO_HOME>/data`，都未设置时使用项目 `data/`。
可通过 `--echo-home`、`--data-dir` 和 `--zemax-python` 适配其他部署。务必与在线服务的路径保持一致，
不要把旧快捷启动脚本的 `.codex-run/echo/data` 当成当前服务的数据目录。
Blender、KiCad、SolidWorks 复用本机 `D:/AI/BlenderMCP`、`D:/AI/KiCadAutomation`、
`D:/AI/SolidWorksMCP` 环境。迁移到其他电脑时先配置这些外部依赖，并修改相应源包的 `.mcp.json`。

配置变更在 Echo 后端下次启动时生效。桌面版与网页共用这个后端；仅刷新网页不会重新注册工具。
MCP 工具名形如 `mcp_solidworks_local_sw_health`、`mcp_zemax_zemax_environment`，
可以通过工具搜索发现。插件技能及其参考文档保留原有 CAD 操作规则。

本地设备安装和登录用户的权限记录分开管理。登录用户如果在插件页看到“启用”，可在当前账户启用；
安装器不替其他账户授予权限。MCP 启动配置是当前本地 Echo 设备的配置，不适用于共享托管部署。
本次迁移已为现有登录账户启用四个插件，并验证四个技能动作通过权限检查。

## 使用前提

- Blender：MCP 插件需启用并监听 `127.0.0.1:9876`。
- KiCad：复用本机 KiCad 10 环境；实时编辑需要启用 IPC。
- SolidWorks：使用既有 COM 串行队列；先调用 `sw_health`，再按技能说明操作文档。
- Zemax：环境检测与工具发现无需打开 OpticStudio；实际光学操作需要有效的 ZOS-API 许可证，
  连接当前界面前需开启 Programming → Interactive Extension。

## 验证与回滚

实测完成了四个服务的 MCP 初始化、工具列表和 Echo 工具注册，共 103 个工具。
没有新建、打开、修改、保存 CAD 文档，也没有进行光学计算或商业软件许可证验收。
安装记录、完整工具清单及配置备份路径见 `<数据目录>/personal-cad-migration.json`。

旧插件由生命周期事务保存在 `data/plugins/codex/.lifecycle/backups/`；
可使用 `runtime.platform.plugins.plugin_lifecycle.rollback_plugin_transaction` 按记录中的事务 ID 回滚。
启动配置备份位于 `<ECHO_HOME 或 ~/.echo>/backups/config-before-cad-*.yaml`，恢复后需重启后端。
本次存在数据目录校正步骤，完整迁移前的配置以记录中的 `original_config_backup` 为准。
不要删除模型、CAD 应用环境或 SolidWorks 作业锁来卸载插件。

相关回归覆盖在 `tests/test_personal_cad_plugins.py`：四个插件的技能加载、活动数据目录优先级、
配置合并、工作目录与长任务超时、禁止注册时执行工具、真实 stdio 握手/错误返回/重连/关闭。

2026-09-25 扩展测试：157 项通过，5 项失败，失败均在 `test_app_meta_endpoints.py`，
涉及 PDF/设计/财务技能资源缺失、财务角色集合与本地认证提供方预期不符；未将这些失败计作迁移验证通过。
最终迁移相关回归 120 项通过，工具目录/作用域回归 103 项通过；Ruff、mypy 和架构不变量检查通过。
在线后端已于 2026-09-25 19:30（上海时间）重启，健康检查正常，注册表共 351 项技能，包含 103 个 CAD MCP 工具。
已在登录后的 HUB → 应用 → 已安装页面确认四个插件均可见。
