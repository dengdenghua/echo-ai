import type { Translations } from "@/core/i18n/locales/types";

export interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  required?: boolean;
  hint?: string;
}

export function getPlatformFields(t: Translations): Record<string, FieldDef[]> {
  return {
    slack: [
      {
        key: "bot_token",
        label: "Bot User OAuth Token",
        placeholder: "xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx-...",
        secret: true,
        required: true,
        hint: t.channelCredential.slackBotTokenHint,
      },
      {
        key: "signing_secret",
        label: "Signing Secret",
        placeholder: "3f...(32 hex)",
        secret: true,
        required: true,
        hint: t.channelCredential.slackSigningSecretHint,
      },
    ],
    dingtalk: [
      {
        key: "webhook_url",
        label: "Webhook URL",
        placeholder: "https://oapi.dingtalk.com/robot/send?access_token=...",
        required: true,
        hint: t.channelCredential.dingtalkWebhookUrlHint,
      },
      {
        key: "secret",
        label: t.channelCredential.dingtalkSecretLabel,
        placeholder: "SECxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        secret: true,
        required: false,
        hint: t.channelCredential.dingtalkSecretHint,
      },
    ],
    feishu: [
      {
        key: "app_id",
        label: "App ID",
        placeholder: "cli_xxxxxxxxxxxx",
        required: true,
        hint: t.channelCredential.feishuAppIdHint,
      },
      {
        key: "app_secret",
        label: "App Secret",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        secret: true,
        required: true,
      },
      {
        key: "verification_token",
        label: "Verification Token",
        placeholder: t.channelCredential.feishuVerificationTokenPlaceholder,
        secret: true,
        required: true,
        hint: t.channelCredential.feishuVerificationTokenHint,
      },
    ],
    telegram: [
      {
        key: "bot_token",
        label: "Bot Token",
        placeholder: "123456789:ABCdef...",
        secret: true,
        required: true,
        hint: t.channelCredential.telegramBotTokenHint,
      },
      {
        key: "webhook_secret",
        label: t.channelCredential.telegramWebhookSecretLabel,
        placeholder: t.channelCredential.telegramWebhookSecretPlaceholder,
        secret: true,
        required: false,
        hint: t.channelCredential.telegramWebhookSecretHint,
      },
    ],
    discord: [
      {
        key: "bot_token",
        label: "Bot Token",
        placeholder: t.channelCredential.discordBotTokenPlaceholder,
        secret: true,
        required: true,
        hint: t.channelCredential.discordBotTokenHint,
      },
      {
        key: "public_key",
        label: "Application Public Key",
        placeholder: t.channelCredential.discordPublicKeyPlaceholder,
        required: true,
        hint: t.channelCredential.discordPublicKeyHint,
      },
    ],
    signal: [
      {
        key: "phone_number",
        label: "Phone Number",
        placeholder: "+1234567890",
        required: true,
      },
      {
        key: "api_base_url",
        label: "Signal CLI REST API URL",
        placeholder: "http://localhost:8080",
        required: true,
      },
      {
        key: "webhook_secret",
        label: "Webhook Secret",
        placeholder: "optional shared secret",
        secret: true,
        required: false,
      },
    ],
    whatsapp: [
      {
        key: "phone_number_id",
        label: "Phone Number ID",
        placeholder: "123456789012345",
        required: true,
      },
      {
        key: "access_token",
        label: "Access Token",
        placeholder: "EAAx...",
        secret: true,
        required: true,
      },
      {
        key: "verify_token",
        label: "Verify Token",
        placeholder: "my-verify-token",
        secret: true,
        required: true,
      },
      {
        key: "app_secret",
        label: "App Secret",
        placeholder: "abc123...",
        secret: true,
        required: false,
      },
    ],
    email: [
      {
        key: "smtp_host",
        label: "SMTP Host",
        placeholder: "smtp.gmail.com",
        required: true,
      },
      {
        key: "smtp_port",
        label: "SMTP Port",
        placeholder: "587",
        required: true,
      },
      {
        key: "imap_host",
        label: "IMAP Host",
        placeholder: "imap.gmail.com",
        required: true,
      },
      {
        key: "username",
        label: "Username",
        placeholder: "bot@example.com",
        required: true,
      },
      {
        key: "password",
        label: "Password",
        placeholder: "app-specific password",
        secret: true,
        required: true,
      },
      {
        key: "from_address",
        label: "From Address",
        placeholder: "bot@example.com",
        required: true,
      },
    ],
    sms: [
      {
        key: "account_sid",
        label: "Account SID",
        placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        required: true,
      },
      {
        key: "auth_token",
        label: "Auth Token",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        secret: true,
        required: true,
      },
      {
        key: "from_number",
        label: "From Number",
        placeholder: "+1234567890",
        required: true,
      },
    ],
    mattermost: [
      {
        key: "bot_token",
        label: "Bot Token",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        secret: true,
        required: true,
      },
      {
        key: "server_url",
        label: "Server URL",
        placeholder: "https://mattermost.example.com",
        required: true,
      },
    ],
    matrix: [
      {
        key: "homeserver_url",
        label: "Homeserver URL",
        placeholder: "https://matrix.org",
        required: true,
      },
      {
        key: "access_token",
        label: "Access Token",
        placeholder: "syt_...",
        secret: true,
        required: true,
      },
    ],
    wecom: [
      {
        key: "corp_id",
        label: "Corp ID",
        placeholder: "wwxxxxxxxxxxxxxxxxxxxxxxxx",
        required: true,
      },
      {
        key: "agent_id",
        label: "Agent ID",
        placeholder: "1000002",
        required: true,
      },
      {
        key: "secret",
        label: "Secret",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        secret: true,
        required: true,
      },
      {
        key: "token",
        label: "Callback Token",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        secret: true,
        required: true,
      },
      {
        key: "encoding_aes_key",
        label: "Encoding AES Key",
        placeholder: "43 chars base64",
        secret: true,
        required: true,
      },
    ],
    qqbot: [
      {
        key: "app_id",
        label: "App ID",
        placeholder: "xxxxxxxxxxxxxxxx",
        required: true,
      },
      {
        key: "app_secret",
        label: "App Secret",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        secret: true,
        required: true,
      },
    ],
    teams: [
      {
        key: "app_id",
        label: "App ID (Microsoft App ID)",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        required: true,
      },
      {
        key: "app_password",
        label: "App Password",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        secret: true,
        required: true,
      },
    ],
    line: [
      {
        key: "channel_access_token",
        label: "Channel Access Token",
        placeholder: "xxx...",
        secret: true,
        required: true,
      },
      {
        key: "channel_secret",
        label: "Channel Secret",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        secret: true,
        required: true,
      },
    ],
    homeassistant: [
      {
        key: "ha_url",
        label: "Home Assistant URL",
        placeholder: "http://homeassistant.local:8123",
        required: true,
      },
      {
        key: "long_lived_token",
        label: "Long-Lived Access Token",
        placeholder: "eyJ...",
        secret: true,
        required: true,
      },
    ],
    bluebubbles: [
      {
        key: "server_url",
        label: "BlueBubbles Server URL",
        placeholder: "http://localhost:1234",
        required: true,
      },
      {
        key: "api_key",
        label: "API Key",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        secret: true,
        required: true,
      },
      {
        key: "password",
        label: "Password",
        placeholder: "optional",
        secret: true,
        required: false,
      },
    ],
    ntfy: [
      {
        key: "server_url",
        label: "ntfy Server URL",
        placeholder: "https://ntfy.sh",
        required: true,
      },
      {
        key: "topic",
        label: "Topic",
        placeholder: "my-agent-topic",
        required: true,
      },
    ],
    webhooks: [
      {
        key: "webhook_secret",
        label: "Webhook Secret",
        placeholder: "shared HMAC secret",
        secret: true,
        required: true,
      },
      {
        key: "outbound_url",
        label: "Outbound URL",
        placeholder: "https://example.com/webhook",
        required: true,
      },
    ],
    google_chat: [
      {
        key: "service_account_key",
        label: "Service Account Key (JSON)",
        placeholder: '{"type":"service_account",...}',
        secret: true,
        required: true,
      },
    ],
    simplex: [
      {
        key: "api_base_url",
        label: "SimpleX Chat API URL",
        placeholder: "http://localhost:5225",
        required: true,
      },
    ],
    open_webui: [
      {
        key: "base_url",
        label: "Open WebUI URL",
        placeholder: "http://localhost:3000",
        required: true,
      },
      {
        key: "api_key",
        label: "API Key",
        placeholder: "sk-...",
        secret: true,
        required: true,
      },
    ],
    yuanbao: [
      {
        key: "bot_id",
        label: "Bot ID",
        placeholder: "xxxxxxxxxxxxxxxx",
        required: true,
      },
      {
        key: "bot_token",
        label: "Bot Token",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        secret: true,
        required: true,
      },
    ],
    irc: [
      {
        key: "server",
        label: "IRC Server",
        placeholder: "irc.libera.chat",
        required: true,
      },
      {
        key: "port",
        label: "Port",
        placeholder: "6697",
        required: true,
      },
      {
        key: "nickname",
        label: "Nickname",
        placeholder: "echo-ai",
        required: true,
      },
      {
        key: "channels",
        label: "Channels",
        placeholder: "#echo, #agents",
        required: true,
        hint: "Comma-separated IRC channels",
      },
      {
        key: "password",
        label: "Server Password",
        placeholder: "Optional",
        secret: true,
        required: false,
      },
      {
        key: "use_tls",
        label: "TLS",
        placeholder: "true",
        required: false,
        hint: "Enabled by default; enter false only for a trusted local server",
      },
    ],
    twitch: [
      {
        key: "oauth_token",
        label: "OAuth Token",
        placeholder: "oauth:xxxxxxxxxxxxxxxx",
        secret: true,
        required: true,
      },
      {
        key: "nickname",
        label: "Bot Username",
        placeholder: "echoagent",
        required: true,
      },
      {
        key: "channels",
        label: "Twitch Channels",
        placeholder: "channel_one, channel_two",
        required: true,
        hint: "Comma-separated channel names",
      },
    ],
  };
}
