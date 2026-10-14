/**
 * Copy for the realtime chat header
 * (app/workspace/realtime/[thread_id]/realtime-chat-header.tsx).
 */

export interface ChatHeaderCopy {
  privateChatWith: (name: string) => string;
  /** "已连接: 微信、飞书" — the assistant's linked messaging channels. */
  connectedChannels: (names: string[]) => string;
  /** Channels with a local name; Telegram, Slack and Discord keep theirs. */
  channelNames: Partial<Record<string, string>>;
  automationAndSubscriptions: string;
}

const zhCN: ChatHeaderCopy = {
  privateChatWith: (name) => `与 ${name} 私聊`,
  connectedChannels: (names) => `已连接：${names.join("、")}`,
  channelNames: {
    wechat: "微信",
    dingtalk: "钉钉",
    feishu: "飞书",
    wecom: "企业微信",
  },
  automationAndSubscriptions: "自动化与订阅",
};

const enUS: ChatHeaderCopy = {
  privateChatWith: (name) => `Private chat with ${name}`,
  connectedChannels: (names) => `Connected: ${names.join(", ")}`,
  channelNames: {
    wechat: "WeChat",
    dingtalk: "DingTalk",
    feishu: "Feishu",
    wecom: "WeCom",
  },
  automationAndSubscriptions: "Automations and subscriptions",
};

const jaJP: ChatHeaderCopy = {
  privateChatWith: (name) => `${name} とのプライベートチャット`,
  connectedChannels: (names) => `接続済み：${names.join("、")}`,
  channelNames: {
    wechat: "WeChat",
    dingtalk: "DingTalk",
    feishu: "Feishu",
    wecom: "WeCom",
  },
  automationAndSubscriptions: "オートメーションと購読",
};

const koKR: ChatHeaderCopy = {
  privateChatWith: (name) => `${name}와(과) 비공개 대화`,
  connectedChannels: (names) => `연결됨: ${names.join(", ")}`,
  channelNames: {
    wechat: "WeChat",
    dingtalk: "DingTalk",
    feishu: "Feishu",
    wecom: "WeCom",
  },
  automationAndSubscriptions: "자동화와 구독",
};

export function chatHeaderCopy(locale: string): ChatHeaderCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
