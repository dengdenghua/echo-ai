import { failureDetail, untypedApi, type HttpMethod } from "@/core/api/request";

export interface MailAccount {
  id: string;
  email: string;
  provider: string;
}
export interface MailMessage {
  id: string;
  account_id: string;
  subject: string;
  sender: string;
  to: string;
  reply_to: string;
  message_id: string;
  date: number;
  read: boolean;
  starred: boolean;
  body: string;
  truncated: boolean;
  attachments: string[];
}
export interface MailDraft {
  id: string;
  account_id: string;
  to: string;
  subject: string;
  body: string;
  reply_message_id: string;
  source_id: string;
  source_account_id: string;
  source_folder: "inbox" | "sent";
}
export async function mailboxRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = (options.method ?? "GET").toLowerCase() as HttpMethod;
  const response = await untypedApi.fetch(method, `/api/mailbox${path}`, {
    reason: "callers pass a dynamic /api/mailbox sub-route and verb",
    body: options.body,
    signal: options.signal,
    // Historically sent on every call, including bodiless GETs.
    headers: { "Content-Type": "application/json" },
    errorMessage: (failure) => {
      const detail = failureDetail(failure);
      return typeof detail === "string"
        ? detail
        : `邮箱请求失败（${failure.status}）`;
    },
  });
  // An empty or non-JSON 2xx body resolves to null, as before.
  return (await response.json().catch(() => null)) as T;
}
