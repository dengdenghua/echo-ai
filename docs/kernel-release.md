# 公共内核的分阶段版本管理

`runtime/kernel-release.json` 是 AI 与 OS 当前共用的、经过核对的第一阶段清单。
公共源码的维护源声明为 `echo-ai`；OS 保留自己的产品适配层。本阶段没有移动
整个 runtime、改变仓库远端或覆盖产品差异。

清单固定 9 个当前完全一致的设备协议、任务检查点/恢复、文件传输、桌面客户端
与日志模块，以及每仓 6 个有意不同的执行、peer、权限和沙箱模块。`revision`
是完整清单载荷的 SHA256，而不是 Git HEAD。只比较 Git HEAD 不能识别本地未提交源码。
源摘要统一 CRLF/LF；除此之外的变化均需重新核验。清单版本与规范化摘要由
`runtime.release_identity.SUPPORTED_RELEASES` 固定，修改清单后自己重算 revision
不能通过原有审核摘要。

清单包含设备协议 `1.0` 与安全行为合同 `1.1.0`。任务工作区目前沿用既有接口，
本轮没有增加新的 wire 协议版本或宣称支持独立设备中心的自动联合。

## 本地校验

```powershell
.venv\Scripts\python.exe -B tools/kernel_release.py --repo . --output artifacts/kernel-release.json
.venv\Scripts\python.exe -B tools/kernel_release.py --ai-repo E:\AGENT\echo-ai --os-repo E:\AGENT\echo-os --output artifacts/kernel-release-pair.json
```

双仓检查分别使用各仓 Python 的隔离进程，并检查真实导入的 verifier 位置、
项目身份、选定源摘要、安全合同摘要和共同 revision。缺失源码、意外漂移或不同
revision 返回非零。独立 CI 的安全门同时执行内核清单检查和跨端任务恢复回归。

后续修改公共模块时，从维护源提出改动，更新两仓，运行安全行为门及任务回归，
再审核清单版本和固定摘要。产品适配模块不使用盲目覆盖；修改它们也需更新本仓
profile 摘要并核验对应行为。只重算摘要而没有行为验证不构成接受新版本。

## 运行与安装包身份

`/api/health` 的 `runtime.kernel` 只暴露清单版本、revision、设备协议版本、
安全合同版本和 `sourceScopeVerified`，不返回路径、文件列表或解析错误。
身份在当前进程首次读取时固定；改源码后须重启。清单同时打入两个 wheel，
可在全新解包目录检查，不依赖开发仓库里的 `security/` 目录。

这个身份只验证上述选定范围。它不等于整个运行内核的版本冻结、密码学签名、
全套 CI 或设备验收。既有 `verifiedBundle` 的可信发行检查语义保持。

## 跨端回归边界

`test_device_task_live_socket.py` 使用生产 WebSocket 服务端和 `DeviceClient`，
在动态回环端口执行实际临时文件创建与回读。验证无审批不写、旧 revision 拒绝、
重复提交不重放、检查点重建保持结果，并独立读取文件字节/摘要。端点都在本机，
规划器为固定测试计划；它不是实体 Android、自然语言模型或 HTTP 操作员端到端验收。

已有任务/传输回归继续验证执行中关闭服务、结果不明需要核对、授权撤销阻止
后续步骤、旧上传窗口的 attempt 被拒绝及恢复已确认 offset。Android 客户端另用
真实 OkHttp 与 MockWebServer 验证握手、工作区消息、断线和连接替换。

正式发布仍要求干净、已明确版本的源码、全套质量门和实体设备验收。本地未提交
工作区生成的 wheel/APK 必须标记开发构建并保留源码清单与制品摘要。
