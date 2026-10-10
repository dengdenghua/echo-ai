import {
  apiGet,
  apiPost,
  untypedApi,
  type ApiFailure,
} from "@/core/api/request";
import { looseBody } from "@/core/api/response";
import {
  hasMessage,
  hasPending,
  hasQrcode,
  isChannelsDetailResponse,
} from "./guards";

export type ChannelName =
  | "feishu"
  | "slack"
  | "telegram"
  | "wecom"
  | "dingtalk"
  | "wechat"
  | "discord"
  | "signal"
  | "whatsapp"
  | "email"
  | "sms"
  | "mattermost"
  | "matrix"
  | "qqbot"
  | "teams"
  | "line"
  | "homeassistant"
  | "bluebubbles"
  | "ntfy"
  | "webhooks"
  | "google_chat"
  | "simplex"
  | "open_webui"
  | "yuanbao";

export interface ChannelStatus {
  enabled: boolean;
  running: boolean;
}

export interface ChannelsStatusResponse {
  service_running?: boolean;
  channels: Record<string, ChannelStatus>;
}

export interface ChannelStats {
  paired_users: number;
  paired_groups: number;
  pending_requests: number;
}

export interface ChannelDetail {
  name: ChannelName;
  enabled: boolean;
  running: boolean;
  linked: boolean;
  assigned_agent?: string | null;
  stats: ChannelStats;
}

export interface ChannelsDetailResponse {
  channels: ChannelDetail[];
}

export interface DingtalkCredentials {
  client_id: string;
  client_secret: string;
}

export interface FeishuCredentials {
  app_id: string;
  app_secret: string;
}

export interface TelegramCredentials {
  bot_token: string;
}

export interface DiscordCredentials {
  application_id: string;
  bot_token: string;
}

export interface SlackCredentials {
  bot_token: string;
}

export interface WecomCredentials {
  corp_id: string;
  agent_id: string;
  secret: string;
}

export interface SignalCredentials {
  phone_number: string;
  api_base_url: string;
}

export interface WhatsAppCredentials {
  phone_number_id: string;
  access_token: string;
  verify_token: string;
  app_secret: string;
}

export interface EmailCredentials {
  smtp_host: string;
  smtp_port: number;
  imap_host: string;
  username: string;
  password: string;
  from_address: string;
}

export interface SmsCredentials {
  account_sid: string;
  auth_token: string;
  from_number: string;
}

export interface MattermostCredentials {
  bot_token: string;
  server_url: string;
}

export interface MatrixCredentials {
  homeserver_url: string;
  access_token: string;
}

export interface QQBotCredentials {
  app_id: string;
  app_secret: string;
}

export interface TeamsCredentials {
  app_id: string;
  app_password: string;
}

export interface LineCredentials {
  channel_access_token: string;
  channel_secret: string;
}

export interface HomeAssistantCredentials {
  ha_url: string;
  long_lived_token: string;
}

export interface BlueBubblesCredentials {
  server_url: string;
  api_key: string;
  password: string;
}

export interface NtfyCredentials {
  server_url: string;
  topic: string;
}

export interface WebhooksCredentials {
  webhook_secret: string;
  outbound_url: string;
}

export interface GoogleChatCredentials {
  service_account_key: string;
}

export interface SimpleXCredentials {
  api_base_url: string;
}

export interface OpenWebUICredentials {
  base_url: string;
  api_key: string;
}

export interface YuanbaoCredentials {
  bot_id: string;
  bot_token: string;
}

export type ChannelCredentials =
  | DingtalkCredentials
  | FeishuCredentials
  | TelegramCredentials
  | DiscordCredentials
  | SlackCredentials
  | WecomCredentials
  | SignalCredentials
  | WhatsAppCredentials
  | EmailCredentials
  | SmsCredentials
  | MattermostCredentials
  | MatrixCredentials
  | QQBotCredentials
  | TeamsCredentials
  | LineCredentials
  | HomeAssistantCredentials
  | BlueBubblesCredentials
  | NtfyCredentials
  | WebhooksCredentials
  | GoogleChatCredentials
  | SimpleXCredentials
  | OpenWebUICredentials
  | YuanbaoCredentials;

export interface WechatQRResponse {
  session_id: string;
  qr_url: string;
  status: "pending" | "scanned" | "confirmed" | "expired";
}

export type PairingStatus = "pending" | "approved" | "rejected";

export interface PairingRequest {
  id: string;
  channel: ChannelName;
  user_id: string;
  user_name: string;
  user_avatar?: string;
  group_id?: string;
  group_name?: string;
  status: PairingStatus;
  created_at: string;
  expires_at: string;
}

export interface PairingRequestsResponse {
  requests: PairingRequest[];
  total: number;
}

/** ``label: statusText``, this module's historical error wording. */
function failed(label: string) {
  return (failure: ApiFailure): string => `${label}: ${failure.statusText}`;
}

/**
 * The legacy client sent ``Content-Type: application/json`` on these
 * bodiless POSTs; keep the request headers identical.
 */
const JSON_CONTENT_TYPE = { "Content-Type": "application/json" };

// ---------------------------------------------------------------------------
// Implemented endpoints (backend has these)
// ---------------------------------------------------------------------------

export async function getChannelsStatus(): Promise<ChannelsStatusResponse> {
  const data: unknown = await apiGet("/api/channels", {
    errorMessage: (failure) =>
      `Failed to load channels status: HTTP ${failure.status}`,
  });
  const invalid = () =>
    new Error("渠道状态：服务返回的数据格式不完整，请重试。");
  if (Array.isArray(data)) {
    const channels: Record<string, ChannelStatus> = {};
    for (const row of data) {
      if (
        !row ||
        typeof row.platform !== "string" ||
        typeof row.connected !== "boolean"
      )
        throw invalid();
      // The registry marks active adapters as connected and includes inactive
      // platform placeholders. Multiple adapters can share one platform.
      const connected =
        row.connected || channels[row.platform]?.running === true;
      channels[row.platform] = { enabled: connected, running: connected };
    }
    return { channels };
  }
  if (data && typeof data === "object" && "channels" in data) {
    const channels = data.channels;
    if (
      channels &&
      typeof channels === "object" &&
      !Array.isArray(channels) &&
      Object.values(channels).every(
        (status) =>
          status &&
          typeof status.enabled === "boolean" &&
          typeof status.running === "boolean",
      )
    ) {
      return data as ChannelsStatusResponse;
    }
  }
  throw invalid();
}

export async function restartChannel(
  name: ChannelName,
): Promise<{ message: string }> {
  return untypedApi.post<{ message: string }>(`/api/channels/${name}/restart`, {
    reason: "POST /api/channels/{name}/restart is not in the OpenAPI snapshot",
    headers: JSON_CONTENT_TYPE,
    errorMessage: failed(`Failed to restart channel ${name}`),
  });
}

// ---------------------------------------------------------------------------
// Planned endpoints · backend not yet implemented
//
// Every stub throws the SAME typed error so callers can uniformly detect
// "feature not ready" and render a coming-soon UI instead of mistaking the
// empty return for a real success. Previously some stubs returned
// `{channels: []}` / `{requests: []}` which was indistinguishable from a
// valid empty result · users saw "no data" with no hint the feature was
// unimplemented.
// ---------------------------------------------------------------------------

export class ChannelNotImplementedError extends Error {
  readonly endpoint: string;
  constructor(endpoint: string) {
    super(`Channel endpoint not implemented: ${endpoint}`);
    this.name = "ChannelNotImplementedError";
    this.endpoint = endpoint;
  }
}

/** Type guard · survives bundling / instanceof pitfalls across chunks. */
export function isChannelNotImplemented(
  err: unknown,
): err is ChannelNotImplementedError {
  return (
    err instanceof ChannelNotImplementedError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { name?: string }).name === "ChannelNotImplementedError")
  );
}

export async function getChannelsDetail(): Promise<ChannelsDetailResponse> {
  return looseBody(
    await apiGet("/api/channels/detail", {
      errorMessage: failed("Failed to load channels detail"),
    }),
    isChannelsDetailResponse,
  );
}

export async function saveChannelCredentials(
  name: ChannelName,
  credentials: ChannelCredentials,
): Promise<{ message: string }> {
  return untypedApi.post<{ message: string }>(
    `/api/channels/credentials/${name}`,
    {
      reason:
        "the snapshot declares no request body for " +
        "POST /api/channels/credentials/{platform}",
      body: credentials,
      errorMessage: failed(`Failed to save credentials for ${name}`),
    },
  );
}

export async function assignChannelAgent(
  name: ChannelName,
  agentName: string,
): Promise<{ message: string }> {
  return untypedApi.post<{ message: string }>(
    `/api/channels/${name}/assistant`,
    {
      reason:
        "the snapshot declares no request body for " +
        "POST /api/channels/{channel_id}/assistant",
      body: { agent_id: agentName },
      errorMessage: failed(`Failed to assign agent for ${name}`),
    },
  );
}

export async function getWechatQRCode(): Promise<WechatQRResponse> {
  const data = looseBody(
    await apiPost("/api/channels/wechat/qr/start", {
      headers: JSON_CONTENT_TYPE,
      errorMessage: failed("Failed to get WeChat QR code"),
    }),
    hasQrcode,
  );
  return {
    session_id: data.qrcode ?? "",
    qr_url: data.qrcode_img_content ?? "",
    status: "pending",
  } as WechatQRResponse;
}

export async function pollWechatLoginStatus(
  sessionId: string,
): Promise<WechatQRResponse> {
  const data = await untypedApi.post<{
    confirmed?: boolean;
    status?: WechatQRResponse["status"];
  }>("/api/channels/wechat/qr/poll", {
    reason:
      "the snapshot declares no request body for " +
      "POST /api/channels/wechat/qr/poll",
    body: { qrcode: sessionId },
    errorMessage: failed("Failed to poll WeChat status"),
  });
  return {
    session_id: sessionId,
    qr_url: "",
    status: data.confirmed ? "confirmed" : (data.status ?? "pending"),
  };
}

export async function getPairingRequests(params?: {
  channel?: ChannelName;
  status?: PairingStatus;
}): Promise<PairingRequestsResponse> {
  const channelId = params?.channel ?? "all";
  const data = looseBody(
    await apiGet("/api/channels/{channel_id}/pairings", {
      path: { channel_id: channelId },
      errorMessage: failed("Failed to load pairing requests"),
    }),
    hasPending,
  );
  const pending: PairingRequest[] = (data.pending ?? []).map(
    (p: Record<string, unknown>, i: number) => ({
      id: (p.sender_id as string) || String(i),
      channel: (params?.channel ?? channelId) as ChannelName,
      user_id: (p.sender_id as string) ?? "",
      user_name: (p.sender_id as string) ?? "",
      group_id: (p.thread_id as string) ?? undefined,
      group_name: undefined,
      status: "pending" as PairingStatus,
      created_at: p.ts ? new Date((p.ts as number) * 1000).toISOString() : "",
      expires_at: "",
    }),
  );
  const filtered = params?.status
    ? pending.filter((r) => r.status === params.status)
    : pending;
  return { requests: filtered, total: filtered.length };
}

export async function approvePairingRequest(
  id: string,
): Promise<{ message: string }> {
  return looseBody(
    await apiPost("/api/channels/pairing/{pairing_id}/approve", {
      path: { pairing_id: id },
      headers: JSON_CONTENT_TYPE,
      errorMessage: failed(`Failed to approve pairing ${id}`),
    }),
    hasMessage,
  );
}

export async function rejectPairingRequest(
  id: string,
): Promise<{ message: string }> {
  return looseBody(
    await apiPost("/api/channels/pairing/{pairing_id}/reject", {
      path: { pairing_id: id },
      headers: JSON_CONTENT_TYPE,
      errorMessage: failed(`Failed to reject pairing ${id}`),
    }),
    hasMessage,
  );
}
