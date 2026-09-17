# 电脑与浏览器自动化插件

Echo 通过两个随应用交付的 ModulePlugin 管理自动化能力：

| 插件 | 内容 | 可选依赖 |
| --- | --- | --- |
| `computer_control` | 现有电脑、API、UIA 工具，以及宿主注入的视觉循环 | `desktop` extra、系统权限、视觉模型 |
| `browser_control` | Playwright 与 `live_browser_*`，含内置浏览器和扩展 Relay | `browser` extra、浏览器运行时或 Electron / Relay |

在设置的「浏览器自动化」「桌面自动化」页管理安装、启用、停用和卸载。
两者初始沿用已有可用状态；首次修改后将状态持久化到应用数据目录。
工厂插件卸载只撤销激活状态，保留应用内的插件资源和用户数据。

## 执行路径

`build_from_config` 先为工具注册表绑定 PluginHub。自动化组由插件加载，
其余组按原流程注册。无 BuiltStack 的预览应用也复用同一方式。
Web 装配阶段为这个 Hub 补充宿主服务，管理 API 与执行器因此共享工具所有权。
单独嵌入旧 registrar 的调用者仍可使用原有 Python API。

工具名称、参数签名与可信来源保持兼容。Codex、OpenCode 使用原有 Host MCP
工具桥调用 Echo 注册表，模型选择和工具执行仍由现有引擎配置决定。

## 生命周期边界

- 停用注销本插件工具，并撤销旧处理函数；重新启用创建新一代处理函数。
- 重建工具目录、修改自动化权限、延后注入视觉模型均不能绕过插件停用。
- 浏览器、电脑 HTTP 控制入口检查插件可用状态；Relay 长连接定期复查。
- `enable_web_skills: false` 和自动化授权设置是宿主约束，启用插件不能越过。
- 关闭插件不强制关闭用户应用、浏览器、会话，也不撤回已进入驱动的操作。
- 电脑视觉循环在截图、规划和动作边界检查本次激活的撤销状态，等待期间
  每 100 毫秒检查一次。已发出的模型请求和系统调用返回后，不再执行后续动作。
- 管理 API 的 `GET /api/plugin-hub/plugins/{name}/diagnostics` 受操作员权限保护，
  区分插件启用、驱动可用、连接状态及尚未验证的实际执行条件。诊断不发出
  截图、点击、浏览器启动或模型请求，也不会暴露传输错误中的凭据。
- Playwright、系统控制实现仍复用现有驱动模块；HTTP、IPC、设备传输属于宿主。
  本次完成生命周期插件化，没有另起进程隔离或迁移底层驱动包。

验证入口：`tests/test_automation_plugins.py`，以及前端
`automation-plugin-card.test.tsx` 和 `automation-capability-settings.test.tsx`。

## 真实浏览器回归

`tests/test_browser_plugin_e2e.py` 通过插件注册表调用实际 Playwright 工具，
启动隔离的无头 Chromium 和临时本地 HTTP 页面。验证读取、填写、追加输入、
点击后的页面结果、错误选择器后的重试，以及停用/重新启用后的旧工具撤销。
测试不连接用户浏览器，不调用模型，不使用用户登录资料；缺少 Chromium 时会跳过。

运行：`.venv/Scripts/python.exe -m pytest tests/test_browser_plugin_e2e.py -q -rs`。
此检查证明独立浏览器工具链可执行上述操作，不代表 Electron / Relay 已连接，
也不构成模型规划能力或与 Codex 任务成功率的对照结果。

Chrome 扩展真实测试：
`.venv/Scripts/python.exe -m pytest tests/test_chrome_extension_e2e.py -q -rs`。
测试将扩展复制到临时目录，仅将网关地址改为隔离测试端口，使用临时 Chromium
资料目录加载扩展，覆盖认证、WebSocket 推送、表单操作和截图坐标校验。
网关绑定实际 PluginHub，并验证停用及快速重新启用时旧命令仍保持撤销。

Relay WebSocket 断开时，扩展会取消当前命令批次，并通知页面执行层中止等待中的
DOM 动作；已经提交给浏览器的同步动作不能撤回。连接与命令都绑定插件本次激活，
重新启用不会复活旧命令。旧版本网关使用的 HTTP 轮询兼容模式不在此停止保证内。

插件注册期间不执行浏览器工具的 golden tests，防止在已有会话中加载插件时，
测试误用该会话的当前页面；这些检查应在隔离的测试环境中执行。

## Electron 控制桥

当前 `frontend/electron/main.cjs` 在启动时建立认证 loopback HTTP 桥，
兼容后端 `browser_act_skills` 的发现文件和动作协议。开发环境发现文件为
仓库 `data/bridge.json`，正式包为 `userData/data/bridge.json`；指定
`ECHO_DATA_DIR` 时，以该目录为准，独立启动的前后端须使用相同目录。

只有主窗口主 frame 能设置活动标签页，目标必须是该窗口所属的 webview。
未选标签页、标签页销毁后不会宣告可操作；标签页 DOM 就绪、切换和卸载均更新选择。
HTTP 请求需要随机 Bearer 凭据，不接受网页 Origin，不允许传入任意 webContentsId，
请求体限制为 64 KiB。现有脚本执行工具同样仅作用于选中的 webview。
退出时清理当前实例的发现文件，不删除其他实例替换后的文件。

真实验证：在 `frontend` 运行
`pnpm exec playwright test -c playwright.electron.config.ts desktop-browser-bridge.spec.ts`。
该测试用临时资料目录和隐藏窗口启动实际桌面入口，通过 Python ElectronBackend
完成表单操作，验证认证、目标限制、状态读取和脚本协议；不需要启动生产后端。
