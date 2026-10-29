# 手机控制电脑：统一远控链路

## 使用

1. 正常启动 Echo AI 或 Echo OS 桌面端，在“设备互联”完成手机连接。
2. 打开该手机的画面面板，在“手机控制这台电脑”选择“仅观看画面”或“允许观看与操作”。默认不允许，设备配对不等于授权远控。
3. 手机设置或聊天工具栏的“电脑远控”进入同一个页面。主机按需启动画面采集，无需另开脚本或监听端口。
4. 点击电脑文字框后，支持识别的 Windows / X11 主机会打开手机输入栏；也可手动点“键盘”。输入中文后点“发送”，收到电脑确认才清空；断线保留未确认文字，不自动重发。密码框只传递隐藏标志，不读取文字或控件名称。
5. 键盘提供字母、数字、F1–F12、导航键和常用快捷键；修饰键仅影响下一次按键。精准鼠标支持相对移动、左右键、滚动和拖拽，切换模式或断线会释放按住的鼠标。
6. “操作”提供窗口总览、显示桌面、横屏、画质和连接指标。Android 支持且允许画中画时可进入只读小窗；没有可见小窗而退到后台时结束连接。电脑主动结束或撤权会立即停止远控。

一次只允许一台手机远控。权限按设备保存，重启不会自动采集。无桌面的 NAS/服务容器会显示不可用；这项功能共享当前登录的本地桌面，不提供无人登录桌面或 UAC 安全桌面。

## AI / OS 复用边界

两个仓库的 `runtime/tentacle/remote_desktop*.py` 保持同一实现，均由 `TentacleCoordinator` 生命周期管理，手机协议完全相同。当前各自打包，尚未抽成跨仓库发布的独立库。修改核心时必须同步两个仓库，并运行各自回归。

AI 管理接口位于 `/api/tentacle/remote-desktop`，复用现有 operator 身份检查。OS 位于 `/api/appliance/device-link/remote-desktop`，由 appliance 的 operator 边界保护，经 `appliance/agent_api/devices.py` 调用核心。OS 设备监听依然使用现有启用和配对流程。

## 连接与部署

优先 WebRTC 视频和有序输入通道，首帧超时/连接失败后自动切到已有设备 WebSocket 的 JPEG 兼容连接。发送有背压，不堆积旧帧。画质设置为目标上限，实际帧率取决于主机和网络：

| 设置 | WebRTC 最大边长 / 目标帧率 | 兼容画面最大边长 / 目标帧率 |
|---|---|---|
| 自动 | 1280 / 15 | 1280 / 3 |
| 流畅 | 960 / 24 | 960 / 5 |
| 清晰 | 1920 / 15 | 1280 / 3 |
| 省流量 | 854 / 8 | 854 / 2 |

切换画质会重新建立会话，保留未发送文字；已经使用兼容连接时延续该连接方式。分辨率、实际接收帧率和往返时间由当前连接测量。兼容画面适合操作和应急查看，不适合视频或游戏。

跨网前提是手机已经能连接该主机的设备网关。兼容模式复用现有 WSS 网关，不会凭空建立公网入口或自动部署中继。公网使用 WSS；如果现有地址仅是局域网地址，应先启用产品已有的远程访问网关。可部署 TURN 提升 WebRTC 可达性：

- `ECHO_REMOTE_ICE_SERVERS`：JSON 数组，支持标准 STUN/TURN 配置。默认 Cloudflare STUN；`[]` 表示不使用 STUN。
- `ECHO_REMOTE_TURN_URLS`：逗号分隔 TURN/TURNS 地址，例如 `turn:relay.example.com:3478,turns:relay.example.com:5349`。
- `ECHO_REMOTE_TURN_SECRET`：仅主机和 TURN 服务保存的共享密钥；按 TURN REST 方式生成一小时有效凭据，手机不会收到共享密钥。设备标识做摘要后用于临时用户名。

主机和手机使用同一份会话 ICE 配置。配置错误会有明确提示。源码开发使用 `uv sync --extra desktop-core` 或 `--extra remote-desktop`；桌面启动依赖和 Windows 打包规格已加入 aiortc、mss、PyAutoGUI、Pillow 与媒体库。

## 系统声音

手机在“操作”中单独开启系统声音，默认关闭；仅观看权限也可收听。音频不落盘、不读麦克风，也不保存开启偏好。结束、断线、撤权和切到不可见后台时停止采集与播放，重连只传当前声音，不重放旧缓冲。

Windows 使用 PyAudioWPatch 的默认 WASAPI 扬声器回环，拒绝回退到录音设备。Linux 使用 `pulseaudio-utils` 的 `parec --device=@DEFAULT_MONITOR@`，兼容 PipeWire PulseAudio 服务；预览虚拟机和完整镜像均安装该工具。macOS 系统声音尚不支持。

直连使用 WebRTC Opus（48 kHz 双声道）；兼容连接使用 24 kHz 单声道 PCM，通过原有认证网关发送，每包 20ms，约 0.5 Mbps（不含协议开销）。发送等待网关背压，采集仅保留最近三块数据；手机播放缓冲上限约 140ms。设备缺失、拔出或采集失败只降级声音，并提示用户，保留视频和控制。浏览器限制自动播放时显示“点击播放系统声音”。

## 输入与恢复

Windows 中文/表情使用原生 Unicode 输入事件；macOS 使用 Unicode 键盘事件，需授予录屏及辅助功能权限。Linux X11 使用 AT-SPI 或确认后的原生键盘输入，支持中文、表情和输入法恢复，不读写剪贴板。锁屏时拒绝文字输入；Wayland 远控尚不支持。

输入框状态仅包含 available / editable / secure 三个布尔值。探测失败不影响已经成功的点击；无法识别时仍可手动打开输入栏。Linux 窗口总览调用 KWin 的窗口接口；Echo OS 显示桌面时保留桌面外壳，最小化当前工作区的其他应用。

每次连接有 requestId 和 sessionId；输入有递增序号和确认。过期会话、旧连接、重复序号不会操作当前桌面。输入队列满时结束会话，不延迟重放点击。手机每 5 秒心跳，15 秒无回应重新连接；主机断线/撤权/超时释放鼠标与修饰键并结束采集。电脑主动结束不会触发手机自动重连。

## 验证

- `tests/test_remote_desktop.py`：授权、只读、旧连接、队列上限、撤权、资源释放、Unicode/表情、快捷键异常释放、TURN 凭据。
- `tests/test_remote_desktop_api.py`：AI 管理接口身份边界、正常主机装配。
- `tests/test_remote_desktop_audio.py`：声音授权、默认关闭、设备故障、资源释放、真实 RTP 音频解码和兼容 PCM 背压。
- `tests/test_remote_desktop_live.py`：真实 aiortc 视频与 DataChannel 输入确认。
- `tests/test_remote_desktop_experience.py` 与 `tests/test_remote_desktop_actions.py`：画质约束、输入框状态隐私、探测失败、锁屏和桌面窗口操作。
- `tests/test_remote_desktop_browser.py`：实际手机 HTML + 认证 WebSocket + WebRTC/兼容连接，中文输入确认和断线保留。设置 `ECHO_REMOTE_MOBILE_ASSETS` 为手机仓库 assets 目录；可设置 `ECHO_REMOTE_BROWSER_CHANNEL=msedge` 使用已安装浏览器。需安装 Playwright。测试使用合成画面和记录输入的测试驱动，不会操作真实桌面。
- OS 另运行 `tests/appliance/test_remote_desktop.py`，手机仓库运行 `node --test scripts/test-remote-desktop.cjs scripts/test-remote-controls.cjs scripts/test-remote-audio.cjs` 及 Android 构建、lint、detekt、单元测试。

真实 Android 输入法与画中画、手机蜂窝网络、公网 TURN 延迟/丢包及 macOS 权限对话框仍需要设备环境实测。自动化测试通过不代表这些环境已验收。
