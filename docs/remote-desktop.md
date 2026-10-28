# 手机控制电脑：统一远控链路

## 使用

1. 正常启动 Echo AI 或 Echo OS 桌面端，在“设备互联”完成手机连接。
2. 打开该手机的画面面板，在“手机控制这台电脑”选择“仅观看画面”或“允许观看与操作”。默认不允许，设备配对不等于授权远控。
3. 手机设置或聊天工具栏的“电脑远控”进入同一个页面。主机按需启动画面采集，无需另开脚本或监听端口。
4. 手机键盘输入中文后点“发送”，只有电脑确认输入完成才清空文字；断线保留未确认文字，不自动重发。
5. 电脑端可以结束当前会话；改为“不允许”会立即撤销权限。手机退到后台即释放控制，返回后重新连接。

一次只允许一台手机远控。权限按设备保存，重启不会自动采集。无桌面的 NAS/服务容器会显示不可用；这项功能共享当前登录的本地桌面，不提供无人登录桌面或 UAC 安全桌面。

## AI / OS 复用边界

两个仓库的 `runtime/tentacle/remote_desktop*.py` 保持同一实现，均由 `TentacleCoordinator` 生命周期管理，手机协议完全相同。当前各自打包，尚未抽成跨仓库发布的独立库。修改核心时必须同步两个仓库，并运行各自回归。

AI 管理接口位于 `/api/tentacle/remote-desktop`，复用现有 operator 身份检查。OS 位于 `/api/appliance/device-link/remote-desktop`，由 appliance 的 operator 边界保护，经 `appliance/agent_api/devices.py` 调用核心。OS 设备监听依然使用现有启用和配对流程。

## 连接与部署

优先 WebRTC 视频和有序输入通道，首帧超时/连接失败后自动切到已有设备 WebSocket 的 JPEG 兼容连接。兼容连接约 3 帧/秒，发送有背压、不堆积旧帧；用于操作和应急查看，不适合视频或游戏。WebRTC 目标 15 帧/秒，最大边长 1280，保留屏幕比例。

跨网前提是手机已经能连接该主机的设备网关。兼容模式复用现有 WSS 网关，不会凭空建立公网入口或自动部署中继。公网使用 WSS；如果现有地址仅是局域网地址，应先启用产品已有的远程访问网关。可部署 TURN 提升 WebRTC 可达性：

- `ECHO_REMOTE_ICE_SERVERS`：JSON 数组，支持标准 STUN/TURN 配置。默认 Cloudflare STUN；`[]` 表示不使用 STUN。
- `ECHO_REMOTE_TURN_URLS`：逗号分隔 TURN/TURNS 地址，例如 `turn:relay.example.com:3478,turns:relay.example.com:5349`。
- `ECHO_REMOTE_TURN_SECRET`：仅主机和 TURN 服务保存的共享密钥；按 TURN REST 方式生成一小时有效凭据，手机不会收到共享密钥。设备标识做摘要后用于临时用户名。

主机和手机使用同一份会话 ICE 配置。配置错误会有明确提示。源码开发使用 `uv sync --extra desktop-core` 或 `--extra remote-desktop`；桌面启动依赖和 Windows 打包规格已加入 aiortc、mss、PyAutoGUI、Pillow 与媒体库。

## 输入与恢复

Windows 中文/表情使用原生 Unicode 输入事件；macOS 使用 Unicode 键盘事件，需授予录屏及辅助功能权限。Linux 当前支持 X11 画面和基础输入，非 ASCII 文本明确返回失败，不会丢弃手机文本；Wayland 和 Linux 中文输入尚未实现。

每次连接有 requestId 和 sessionId；输入有递增序号和确认。过期会话、旧连接、重复序号不会操作当前桌面。输入队列满时结束会话，不延迟重放点击。手机每 5 秒心跳，15 秒无回应重新连接；主机断线/撤权/超时释放鼠标与修饰键并结束采集。电脑主动结束不会触发手机自动重连。

## 验证

- `tests/test_remote_desktop.py`：授权、只读、旧连接、队列上限、撤权、资源释放、Unicode/表情、快捷键异常释放、TURN 凭据。
- `tests/test_remote_desktop_api.py`：AI 管理接口身份边界、正常主机装配。
- `tests/test_remote_desktop_live.py`：真实 aiortc 视频与 DataChannel 输入确认。
- `tests/test_remote_desktop_browser.py`：实际手机 HTML + 认证 WebSocket + WebRTC/兼容连接，中文输入确认和断线保留。设置 `ECHO_REMOTE_MOBILE_ASSETS` 为手机仓库 assets 目录；可设置 `ECHO_REMOTE_BROWSER_CHANNEL=msedge` 使用已安装浏览器。需安装 Playwright。测试使用合成画面和记录输入的测试驱动，不会操作真实桌面。
- OS 另运行 `tests/appliance/test_remote_desktop.py`，手机仓库运行 `node --test scripts/test-remote-desktop.cjs` 及 Android 构建、lint、detekt、单元测试。

真实手机蜂窝网络、实际公网 TURN 延迟/丢包和 macOS 权限对话框仍需要设备环境实测。自动化测试通过不代表这些环境已验收。
