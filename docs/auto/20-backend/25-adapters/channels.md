---
type: "AdapterSubsystem"
title: "Adapters · Channels"
description: "外部 channel adapter (Slack / Discord / 微信 / …) · 必须走 validation safe_send 才允许出站。"
tags: ["backend", "adapters"]
tier: "standard"
---
# Adapters · Channels

> 外部 channel adapter (Slack / Discord / 微信 / …) · 必须走 validation safe_send 才允许出站。

**Source**: `runtime/adapters/channels/`

## Exports

- `Attachment`
- `BlueBubblesChannel`
- `BlueBubblesError`
- `Channel`
- `ChannelManager`
- `ChannelMetadata`
- `ChannelOperationsStore`
- `ChannelRoutingError`
- `DingTalkChannel`
- `DingTalkError`
- `DingTalkSignatureError`
- `DiscordChannel`
- `DiscordError`
- `DiscordSignatureError`
- `EmailChannel`
- `EmailError`
- `FeishuChannel`
- `FeishuError`
- `FeishuSignatureError`
- `GoogleChatChannel`
- `GoogleChatError`
- `GoogleChatSignatureError`
- `HomeAssistantChannel`
- `HomeAssistantError`
- `InboundMessage`
- `IRCChannel`
- `IRCError`
- `IRCMessage`
- `LineChannel`
- `LineError`
- `LineSignatureError`
- `MattermostChannel`
- `MattermostError`
- `MattermostSignatureError`
- `MatrixChannel`
- `MatrixError`
- `MatrixSignatureError`
- `NtfyChannel`
- `NtfyError`
- `OpenWebUIChannel`
- `OpenWebUIError`
- `OutboundMessage`
- `QQBotChannel`
- `QQBotError`
- `QQBotSignatureError`
- `QRLoginTimeout`
- `SignalChannel`
- `SignalError`
- `SignalSignatureError`
- `SimpleXChannel`
- `SimpleXError`
- `SlackChannel`
- `SlackSignatureError`
- `SmsChannel`
- `SmsError`
- `SmsSignatureError`
- `TeamsChannel`
- `TeamsError`
- `TeamsSignatureError`
- `TelegramChannel`
- `TelegramError`
- `TelegramSecretMismatch`
- `ThreadConversationStore`
- `TwitchChannel`
- `WeComChannel`
- `WeComError`
- `WeComSignatureError`
- `WebhooksChannel`
- `WebhooksError`
- `WebhooksSignatureError`
- `WhatsAppChannel`
- `WhatsAppError`
- `WhatsAppSignatureError`
- `WeixinBotChannel`
- `WeixinBotError`
- `YuanbaoChannel`
- `YuanbaoError`
- `YuanbaoSignatureError`
- `resolve_attachment_data`
- `parse_irc_line`

## Modules

| Module | Summary |
| --- | --- |
| `_webhook_auth.py` | Shared inbound-webhook authentication helpers for channel adapters. |
| `base.py` | — |
| `bluebubbles.py` | — |
| `dingtalk.py` | — |
| `discord.py` | — |
| `email.py` | — |
| `feishu.py` | — |
| `google_chat.py` | — |
| `homeassistant.py` | — |
| `irc.py` | — |
| `line.py` | — |
| `manager.py` | — |
| `matrix.py` | — |
| `mattermost.py` | — |
| `ntfy.py` | — |
| `open_webui.py` | — |
| `operations.py` | — |
| `qqbot.py` | — |
| `signal.py` | — |
| `simplex.py` | — |
| `slack.py` | — |
| `sms.py` | — |
| `store.py` | — |
| `teams.py` | — |
| `telegram.py` | — |
| `webhooks.py` | — |
| `wecom.py` | — |
| `weixin_bot.py` | — |
| `whatsapp.py` | — |
| `yuanbao.py` | — |

## Key classes & functions

> AST 自动提取 · 仅列公开顶层 class / function · 签名与真实代码一致。

### `_webhook_auth.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class WebhookAuthError(ValueError)` | Inbound webhook failed authentication (maps to HTTP 401). |
| func | `def secrets_match(provided, expected)` | Constant-time secret comparison; empty/non-string values never match. |
| func | `def header_value(headers, name)` | Case-insensitive header lookup (the router lower-cases, tests may not). |
| func | `def bearer_token(headers)` |  |
| func | `def check_webhook_secret(expected, headers, query, error_cls)` | Require the configured shared secret when one is set (fail closed). |
| func | `def host_allowed(url, allowed_hosts)` | True when *url* is https and its host matches the allowlist. |
| func | `def rsa_key_from_jwk(jwk)` |  |
| func | `def rsa_key_from_pem_cert(pem)` |  |
| func | `def keys_from_jwks(jwks)` |  |
| func | `def keys_from_x509_map(certs)` |  |
| class | `class RemoteKeySet` | Thread-safe cache of ``kid -> (public_key, jwk)`` from a remote source. |
| func | `def verify_rs256_jwt(token, resolve_key, issuers, audiences, leeway_seconds, now, error_cls)` | Verify an RS256 JWT and return ``(claims, jwk)``; raise *error_cls* otherwise. |

### `base.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class Attachment` |  |
| class | `class ChannelMetadata(TypedDict)` |  |
| func | `def resolve_attachment_data(att)` |  |
| class | `class InboundMessage` |  |
| class | `class OutboundMessage` |  |
| class | `class Channel(ABC)` |  |

### `bluebubbles.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class BlueBubblesError(RuntimeError)` |  |
| class | `class BlueBubblesChannel(Channel)` |  |

### `dingtalk.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class DingTalkError(RuntimeError)` |  |
| class | `class DingTalkSignatureError(ValueError)` |  |
| class | `class DingTalkChannel(Channel)` |  |

### `discord.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class DiscordError(RuntimeError)` |  |
| class | `class DiscordSignatureError(ValueError)` |  |
| class | `class DiscordChannel(Channel)` |  |

### `email.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class EmailError(RuntimeError)` |  |
| class | `class EmailChannel(Channel)` |  |

### `feishu.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class FeishuError(RuntimeError)` |  |
| class | `class FeishuSignatureError(ValueError)` |  |
| class | `class FeishuChannel(Channel)` |  |

### `google_chat.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class GoogleChatError(RuntimeError)` |  |
| class | `class GoogleChatSignatureError(ValueError)` |  |
| class | `class GoogleChatChannel(Channel)` |  |

### `homeassistant.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class HomeAssistantError(RuntimeError)` |  |
| class | `class HomeAssistantChannel(Channel)` |  |

### `irc.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class IRCError(RuntimeError)` |  |
| class | `class IRCMessage` |  |
| func | `def parse_irc_line(line)` | Parse one IRC/IRCv3 line without accepting embedded control lines. |
| class | `class IRCChannel(Channel)` | Long-lived IRC adapter with IRCv3 IDs and automatic reconnects. |
| class | `class TwitchChannel(IRCChannel)` |  |

### `line.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class LineError(RuntimeError)` |  |
| class | `class LineSignatureError(ValueError)` |  |
| class | `class LineChannel(Channel)` |  |

### `manager.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class ChannelRoutingError(RuntimeError)` |  |
| func | `def current_channel_target()` | Return the ``(channel_id, thread_id)`` of the current IM turn, if any. |
| class | `class ChannelManager` |  |

### `matrix.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class MatrixError(RuntimeError)` |  |
| class | `class MatrixSignatureError(ValueError)` |  |
| class | `class MatrixChannel(Channel)` |  |

### `mattermost.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class MattermostError(RuntimeError)` |  |
| class | `class MattermostSignatureError(ValueError)` |  |
| class | `class MattermostChannel(Channel)` |  |

### `ntfy.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class NtfyError(RuntimeError)` |  |
| class | `class NtfyChannel(Channel)` |  |

### `open_webui.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class OpenWebUIError(RuntimeError)` |  |
| class | `class OpenWebUIChannel(Channel)` |  |

### `operations.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class ChannelOperationsStore` | Durable, bounded operational state for external message channels. |

### `qqbot.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class QQBotError(RuntimeError)` |  |
| class | `class QQBotSignatureError(ValueError)` |  |
| class | `class QQBotChannel(Channel)` |  |

### `signal.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class SignalError(RuntimeError)` |  |
| class | `class SignalSignatureError(ValueError)` |  |
| class | `class SignalChannel(Channel)` |  |

### `simplex.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class SimpleXError(RuntimeError)` |  |
| class | `class SimpleXChannel(Channel)` |  |

### `slack.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class SlackSignatureError(ValueError)` |  |
| class | `class SlackChannel(Channel)` |  |

### `sms.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class SmsError(RuntimeError)` |  |
| class | `class SmsSignatureError(ValueError)` |  |
| class | `class SmsChannel(Channel)` |  |

### `store.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class ThreadConversationStore` |  |

### `teams.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class TeamsError(RuntimeError)` |  |
| class | `class TeamsSignatureError(ValueError)` |  |
| class | `class TeamsChannel(Channel)` |  |

### `telegram.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class TelegramError(RuntimeError)` |  |
| class | `class TelegramSecretMismatch(ValueError)` |  |
| class | `class TelegramChannel(Channel)` |  |

### `webhooks.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class WebhooksError(RuntimeError)` |  |
| class | `class WebhooksSignatureError(ValueError)` |  |
| class | `class WebhooksChannel(Channel)` |  |

### `wecom.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class WeComError(RuntimeError)` |  |
| class | `class WeComSignatureError(ValueError)` |  |
| class | `class WeComChannel(Channel)` |  |

### `weixin_bot.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class WeixinBotError(RuntimeError)` |  |
| class | `class QRLoginTimeout(WeixinBotError)` |  |
| class | `class WeixinBotChannel(Channel)` |  |

### `whatsapp.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class WhatsAppError(RuntimeError)` |  |
| class | `class WhatsAppSignatureError(ValueError)` |  |
| class | `class WhatsAppChannel(Channel)` |  |

### `yuanbao.py`

| Kind | Symbol | Doc |
| --- | --- | --- |
| class | `class YuanbaoError(RuntimeError)` |  |
| class | `class YuanbaoSignatureError(ValueError)` |  |
| class | `class YuanbaoChannel(Channel)` |  |


## Who imports this

**5** file(s) reference this package:

- **`runtime/cli_serve.py/`** · 1 file(s)
  - `runtime/cli_serve.py`
- **`runtime/evals/`** · 1 file(s)
  - `runtime/evals/multi_agent_benchmark.py`
- **`runtime/execution/`** · 1 file(s)
  - `runtime/execution/suckers/cron_skills.py`
- **`runtime/sensing/`** · 2 file(s)
  - `runtime/sensing/gateway/_channels_constructors.py`
  - `runtime/sensing/gateway/channels_router.py`

