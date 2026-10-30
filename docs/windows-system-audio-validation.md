# Windows 系统声音验收

Windows 使用 `pyaudiowpatch` 的默认 WASAPI 扬声器回环。不能用默认录音设备或虚拟线缆的录音端代替回环；后者无法证明系统输出采集路径正确。

本机测试先从 [VB-Audio 官方页面](https://vb-audio.com/Cable/) 单独安装 VB-CABLE，并核验安装器和 Windows 驱动签名。驱动属于独立测试环境，不集成进 Echo 安装流程。测试默认输出为 CABLE Input，采集对象明确带有 `[Loopback]` 且 `isLoopbackDevice=True`。

## 可重复的原生集成测试

在独立 Windows 测试环境中，把已安装的虚拟线缆设为默认输出，安装项目的桌面音频依赖后执行：

```powershell
$env:ECHO_TEST_WINDOWS_AUDIO = '1'
& ./.venv/Scripts/python.exe -m pytest tests/test_remote_desktop_windows_audio.py -q
```

默认不运行此测试。它只接受 VB-CABLE 虚拟输出，不向物理扬声器播放测试音，也不修改系统默认设备。真实输出流与产品回环采集同时运行，检查：

- 48kHz 双声道和 24kHz 单声道的帧大小、音量与两个频率成分。
- 输出频率变化及时到达采集端，旧声音没有持续滞留；静音后回到安静状态。
- 连续三次会话释放和重新打开，关闭后的原生流不可继续访问。

## 安装包端到端测试

2026-10-31 的本机验收还使用了已安装的 AI、OS 冻结后端和 APK 内实际手机页面。独立程序向 Windows 虚拟扬声器播放双频测试音，经过原生 WASAPI、WebRTC / Opus 或受阻后的 WSS 兼容链路，在客户端分析音量和频谱变化。

两种传输均需检查默认关闭、主动开启、静音与恢复、源静音与换音、真实 WebSocket 断开、实际后端进程重启及主动结束。浏览器的设备输出应静音以避免客户端回放重新进入系统回环；客户端音频图和解码仍实际运行。只保存测量结果，不保存音频录音。

端到端记录位于本机 `E:/AGENT/analysis/windows-audio-20261031/`。本机安全 WSS 入口和浏览器页面测试不能代替公网 / 蜂窝跨网、Android 真机或物理扬声器的体验验收。

## 本轮修复

进程内已有 PortAudio 实例时，PortAudio 不会为新的采集线程再次初始化 Windows COM，导致回环打开失败（`-9999`）。采集线程现显式初始化 COM，并在同一会话工作线程释放资源后平衡释放自己的引用；已有 MTA 模式不计作本次新取得的引用。新增的真实端点复用和 MTA 保留测试覆盖了这个问题。
