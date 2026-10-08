import { getBackendBaseURL } from "@/core/config";
import { jsonAuthHeaders } from "@/core/auth/api";

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
  const response = await fetch(`${getBackendBaseURL()}/api/mailbox${path}`, {
    method: options.method ?? "GET",
    headers: jsonAuthHeaders(),
    signal: options.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof data?.detail === "string"
        ? data.detail
        : `邮箱请求失败（${response.status}）`,
    );
  return data as T;
}
