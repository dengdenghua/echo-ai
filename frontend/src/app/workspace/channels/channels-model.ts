// Row shapes the channels page loads, and the platform → category grouping
// its channel grid is sectioned by.

export type ChannelRow = {
  channel_id: string;
  type: string;
  platform: string;
  connected: boolean;
  display_name: string;
  description: string;
  help_url: string;
  metrics: {
    pairings_count: number;
    group_count: number;
    pending_count: number;
  };
  operations: {
    health_status: "unknown" | "healthy" | "degraded" | "unsupported";
    last_checked_at?: string | null;
    check_latency_ms?: number | null;
    last_inbound_at?: string | null;
    last_outbound_at?: string | null;
    last_error_at?: string | null;
    last_error?: string | null;
    inbound_count: number;
    outbound_count: number;
    failure_count: number;
    duplicate_count: number;
    thread_count: number;
    capabilities: {
      edit: boolean;
      typing: boolean;
      reactions: boolean;
      health_probe: boolean;
    };
  };
  assigned_agent_id?: string | null;
  assigned_group_id?: string | null;
};

export type AgentLite = {
  id: string;
  name?: string;
  display_name?: string;
  avatar_url?: string | null;
};

export type GroupLite = {
  group_id: string;
  display_name?: string;
  description?: string;
  members: string[];
};

export type ChannelFilter = "all" | "connected" | "unlinked";

export const PLATFORM_CATEGORIES: Record<string, string> = {
  im: "即时通讯",
  china: "国内平台",
  email_sms: "邮件/短信",
  smart_home: "智能家居",
  dev_tools: "开发工具",
};

export const PLATFORM_CATEGORY_MAP: Record<string, string> = {
  telegram: "im",
  discord: "im",
  slack: "im",
  signal: "im",
  whatsapp: "im",
  matrix: "im",
  mattermost: "im",
  simplex: "im",
  line: "im",
  irc: "im",
  twitch: "im",
  wechat: "china",
  feishu: "china",
  dingtalk: "china",
  wecom: "china",
  qqbot: "china",
  yuanbao: "china",
  email: "email_sms",
  sms: "email_sms",
  homeassistant: "smart_home",
  ntfy: "smart_home",
  webhooks: "dev_tools",
  open_webui: "dev_tools",
  google_chat: "dev_tools",
  bluebubbles: "dev_tools",
  teams: "dev_tools",
};

export const CATEGORY_ORDER = [
  "im",
  "china",
  "email_sms",
  "smart_home",
  "dev_tools",
];
