import { executionEngineCopy } from "@/core/i18n/locales/execution-engine";

export type EngineCapabilityChecks = Partial<Record<"chat" | "web_search" | "tools", {
  state: "untested" | "verified" | "failed";
  model?: string | null;
  checked_at?: number;
}>>;

export function engineVerificationLabel(checks: EngineCapabilityChecks | undefined, locale: string, now = Date.now()) {
  const text = executionEngineCopy(locale).verification;
  const check = checks?.chat;
  const fresh = check?.checked_at && now / 1000 - check.checked_at >= 0 && now / 1000 - check.checked_at < 300;
  if (fresh && check.state === "verified") return text.verified;
  if (fresh && check.state === "failed") return text.failed;
  return text.configured;
}
