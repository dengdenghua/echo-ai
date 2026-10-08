# 本地开发实例

先运行 `Start-Echo.cmd -Check`，或在 `frontend` 运行 `pnpm dev:check`。
预检只读取 Python 实际导入来源、依赖入口及本机端口身份，不启动服务，不创建状态，
不读取配置中的凭据。预检失败时修复依赖或选择空闲端口后再启动。

`E:\AGENT\echo-ai` 副本默认使用后端 18310、前端 13310、设备 WebSocket 18765；
其他源码目录保留后端 8310、前端 3310、设备 WebSocket 8765。
副本状态默认位于该项目 `.codex-run/echo/data`。

启动网页可用 `Start-Echo.cmd -Web`；开发联调用 `frontend` 下的 `pnpm dev:full`。
使用 `-BackendPort`、`-FrontendPort`、`-TentaclePort` 或对应
`GATEWAY_PORT`、`FRONTEND_PORT`、`ECHO_TENTACLE_WS_PORT` 环境变量覆盖端口。
`ECHO_AGENT_PYTHON` 可指定 Python，`ECHO_AGENT_CONFIG` 可指定配置；
`ECHO_HOME`、`ECHO_DATA_DIR`、`ECHO_DEV_DATA_DIR` 的显式设置会保留。

启动器通过代码根和状态目录的散列核对后端、Vite 及代理。只有同一实例才可复用，
占用端口的其他服务不会被终止。设备端口覆盖仅修改本次进程内配置，不改写 YAML。
