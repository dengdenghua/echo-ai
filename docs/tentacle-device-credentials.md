# Echo AI 中枢逐设备凭据

本文是 echo-ai 专属补充；`docs/device-interconnect.md` 与 echo-os 保持字节一致，其中“独立 Echo AI”一节已概述本功能（默认开启的逐设备邀请、绑定、撤销和轮换，以及共享令牌的兼容限制）。

实现：`runtime/tentacle/device_credentials.py`（不修改受 `runtime/kernel-release.json` 固定的 `ws_server.py`，而是像 echo-os `appliance/device_link.py` 一样替换服务器实例的 `_check_auth` 并设置 `is_per_device_auth = True`）。

## 默认值与开关

| 环境变量 | 默认 | 作用 |
| --- | --- | --- |
| `ECHO_TENTACLE_PER_DEVICE_AUTH` | 开启 | 主应用（`_app_collab.py`）启动 Tentacle 时安装逐设备凭据。设为 `0` 恢复纯共享令牌中枢。 |
| `ECHO_TENTACLE_ALLOW_SHARED_TOKEN` | 开启 | 兼容旧的 `join-info` 共享令牌：仍可连接，但这类连接发起的 `device/call` 一律返回 `-32098`。设为 `0` 后只接受逐设备凭据。 |
| `ECHO_TENTACLE_PUBLIC_WS_URL` | 空 | 邀请链接中的 `ws` 地址；为空时使用 `ws://<LAN IP>:<端口>`。经 HTTPS 反代时设为 `wss://<域名>/api/tentacle/device/ws`。 |

共享令牌永远不能占用已配对的设备 ID。`ECHO_ALLOW_INSECURE_SHARED_TOKEN_PEER_CALLS=1` 仍是仅供联调的逃生开关。

## 存储

`<数据目录>/tentacle_device_credentials.json`（0600，原子写，无 `.bak`，避免恢复已撤销的凭据）只保存 HMAC-SHA256 摘要；密钥在同目录独立文件 `tentacle_device_credentials.key`（0600）。只复制状态文件无法重新连接。邀请默认 5 分钟有效、一次性，首次 `device/hello` 时绑定到该 `tentacle_id`；之后该令牌即该设备凭据，用于其他 ID 会被拒绝。

## 运维 API（需 admin/operator）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/tentacle/credentials/invites` | 可选 `{"label": "...", "device_id": "..."}`，返回 `connectString`（`echo://join?ws=…&token=…`）和 `expiresAt`。令牌只在此响应中出现一次。 |
| `GET` | `/api/tentacle/credentials/devices` | 已配对设备、在线状态和认证方式，不含摘要。 |
| `DELETE` | `/api/tentacle/credentials/devices/{id}` | 撤销并以 1008 关闭在线连接；之后旧令牌无法重连。 |
| `POST` | `/api/tentacle/credentials/devices/{id}/rotate` | 换发新令牌并断开当前连接，设备用新的 `connectString` 重连。 |

设备间调用仍需在中枢设置 `ECHO_DEVICE_PEER_GRANTS`；逐设备认证只是前提，不代表授权。
