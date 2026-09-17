import type { CapabilityInfo } from "@/core/agents/agent-world-api";

export type CapabilityCategoryId =
  | "installed"
  | "featured"
  | "productivity"
  | "creative"
  | "developer"
  | "business"
  | "other";

export const CAPABILITY_CATEGORIES: ReadonlyArray<{
  id: CapabilityCategoryId;
  label: string;
}> = [
  { id: "installed", label: "已安装" },
  { id: "featured", label: "精选" },
  { id: "productivity", label: "效率" },
  { id: "creative", label: "创意" },
  { id: "developer", label: "开发者工具" },
  { id: "business", label: "业务与运营" },
  { id: "other", label: "其他" },
];

const FEATURED_CAPABILITY_IDS = new Set([
  "browser",
  "documents",
  "spreadsheets",
  "presentations",
  "pdf",
  "visualize",
]);

export function capabilityCategory(
  capability: CapabilityInfo,
): CapabilityCategoryId {
  if (capability.featured || FEATURED_CAPABILITY_IDS.has(capability.id)) {
    return "featured";
  }
  const haystack = [
    capability.category,
    capability.id,
    capability.name,
    capability.name_zh,
    capability.description,
    capability.description_zh,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (
    /(creative|design|image|video|audio|media|canvas|figma|canva|runway|higgsfield|创意|设计|图像|视频|音频|媒体)/.test(
      haystack,
    )
  ) {
    return "creative";
  }
  if (
    /(developer|development|devops|code|database|hosting|deploy|cloud|github|gitlab|vercel|supabase|neon|datadog|开发|代码|数据库|部署|云服务)/.test(
      haystack,
    )
  ) {
    return "developer";
  }
  if (
    /(business|operations|sales|marketing|crm|commerce|shop|seo|analytics|finance|trading|hubspot|shopify|apollo|业务|运营|销售|营销|电商|金融|交易|分析)/.test(
      haystack,
    )
  ) {
    return "business";
  }
  if (
    /(productivity|office|calendar|meeting|mail|email|docs|sheets|drive|notion|slack|效率|办公|日历|会议|邮件|文档|表格|协作)/.test(
      haystack,
    )
  ) {
    return "productivity";
  }
  return "other";
}

export const AUTH_LABEL: Record<string, string> = {
  none: "无需认证",
  token: "Token",
  oauth: "OAuth",
  "server-side": "服务端",
  "oneid-token": "OneID",
};

export const PERMISSION_LABELS: Record<string, string> = {
  "content.read": "读取工作内容",
  "content.write": "修改或创建内容",
  "interaction.user": "发起交互与提示",
  "network.remote": "访问外部网络服务",
  "account.credentials": "使用本机加密保存的账号凭据",
  "process.local": "在本机启动受控进程",
};

/** 轮询 MCP OAuth 授权结果,直到已授权或超时(默认 90s)。 */

export const TYPE_META: Record<string, { badge: string; label: string }> = {
  mcp: { badge: "bg-primary/10 text-primary", label: "MCP" },
  cli: {
    badge: "bg-chart-3/10 text-chart-3 dark:text-chart-3",
    label: "CLI",
  },
  "skill-only": {
    badge: "bg-chart-2/10 text-chart-2 dark:text-chart-2",
    label: "技能",
  },
  plugin: {
    badge: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    label: "插件",
  },
  other: { badge: "bg-muted text-muted-foreground", label: "其他" },
};

export const DEFAULT_TYPE_META = {
  badge: "bg-muted text-muted-foreground",
  label: "其他",
};
