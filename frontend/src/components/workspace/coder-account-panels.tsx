/**
 * The account half of the Codex settings panel: what a connected ChatGPT
 * account allows (connectors, rate limits, usage) and the sign-in choices
 * shown before an account is connected.
 */
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ClipboardIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  Loader2Icon,
  UserRoundIcon,
} from "lucide-react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  CoderApp,
  CoderLoginResult,
  CoderLoginType,
  CoderRateLimits,
  CoderUsage,
} from "@/core/coder/api";
import type { CoderEngineCopy } from "@/core/i18n/locales/coder-engine";
import { cn } from "@/lib/utils";

import {
  openSensitiveAuthorizationUrl,
  UsageStat,
} from "./coder-engine-profile";

export function CoderAccountDetails({
  copy,
  locale,
  hasChatGPTUsage,
  apps,
  appsLoading,
  savingApps,
  onSaveApps,
  rateLimits,
  usage,
}: {
  copy: CoderEngineCopy;
  locale: string;
  hasChatGPTUsage: boolean;
  apps: CoderApp[];
  appsLoading: boolean;
  savingApps: boolean;
  onSaveApps: (selected: string[]) => void;
  rateLimits: CoderRateLimits | undefined;
  usage: CoderUsage | undefined;
}) {
  return (
    <>
      {hasChatGPTUsage ? (
        <details className="group rounded-lg border border-border bg-background/40 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium marker:content-none">
            <ChevronDownIcon className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
            {copy.accountDetails}
          </summary>
          <div className="mt-3 space-y-4 border-t border-border pt-3">
            <div className="space-y-2">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {copy.connectors}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {copy.connectorsHint}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {apps
                  .filter((app) => app.is_accessible)
                  .map((app) => (
                    <button
                      key={app.id}
                      type="button"
                      aria-pressed={app.selected}
                      disabled={savingApps}
                      className={cn(
                        "rounded-lg border p-3 text-left transition",
                        app.selected
                          ? "border-primary/40 bg-primary/[0.07]"
                          : "border-border hover:bg-muted/30",
                      )}
                      onClick={() => {
                        const selected = apps
                          .filter((item) =>
                            item.id === app.id ? !item.selected : item.selected,
                          )
                          .map((item) => item.id);
                        onSaveApps(selected);
                      }}
                    >
                      <span className="flex items-center justify-between gap-2 text-sm font-medium">
                        <span className="truncate">{app.name}</span>
                        {app.selected ? (
                          <CheckCircle2Icon className="size-4 shrink-0 text-primary" />
                        ) : null}
                      </span>
                      {app.description ? (
                        <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                          {app.description}
                        </span>
                      ) : null}
                    </button>
                  ))}
              </div>
              {!appsLoading &&
              apps.filter((app) => app.is_accessible).length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {copy.connectorUnavailable}
                </p>
              ) : null}
            </div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {copy.allowance}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(rateLimits?.buckets ?? []).map((bucket) => {
                const window = bucket.primary;
                return (
                  <div
                    key={bucket.limit_id}
                    className="rounded-lg border border-border bg-background/60 p-3"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-medium">
                        {bucket.limit_name || bucket.limit_id}
                      </span>
                      {window ? (
                        <span className="text-muted-foreground">
                          {Math.round(window.remaining_percent)}%{" "}
                          {copy.remaining}
                        </span>
                      ) : null}
                    </div>
                    {window ? (
                      <>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-[width]"
                            style={{
                              width: `${Math.max(0, Math.min(100, window.used_percent))}%`,
                            }}
                          />
                        </div>
                        <div className="mt-1.5 text-xs text-muted-foreground">
                          {copy.resetsAt}:{" "}
                          {new Date(window.resets_at * 1000).toLocaleString(
                            locale,
                          )}
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <UsageStat
                label={copy.lifetimeTokens}
                value={usage?.summary?.lifetime_tokens}
                locale={locale}
              />
              <UsageStat
                label={copy.peakDailyTokens}
                value={usage?.summary?.peak_daily_tokens}
                locale={locale}
              />
              <UsageStat
                label={copy.resetCredits}
                value={rateLimits?.reset_credits_available}
                locale={locale}
              />
            </div>
          </div>
        </details>
      ) : (
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          {copy.usageUnavailable}
        </p>
      )}
    </>
  );
}

export function CoderAccountLogin({
  copy,
  busy,
  loginPending,
  loginBusy,
  activeLogin,
  copied,
  onCopied,
  authorizationOnly,
  onBeginLogin,
  onCancelLogin,
  onSubmitApiKey,
}: {
  copy: CoderEngineCopy;
  busy: boolean;
  loginPending: boolean;
  loginBusy: CoderLoginType | "cancel" | "logout" | null;
  activeLogin: CoderLoginResult | null;
  copied: boolean;
  onCopied: (copied: boolean) => void;
  authorizationOnly: boolean;
  onBeginLogin: (type: CoderLoginType) => void;
  onCancelLogin: () => void;
  onSubmitApiKey: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div>
        <div className="text-sm font-medium">{copy.account}</div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {copy.browserLoginHint}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy || loginPending}
          onClick={() => onBeginLogin("chatgpt")}
        >
          <UserRoundIcon className="size-3.5" /> {copy.connectChatGPT}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || loginPending}
          onClick={() => onBeginLogin("chatgptDeviceCode")}
        >
          <ExternalLinkIcon className="size-3.5" /> {copy.connectDevice}
        </Button>
      </div>

      {activeLogin ? (
        <div className="rounded-lg border border-info/25 bg-info/[0.05] p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-info">
            <Loader2Icon className="size-4 animate-spin" /> {copy.pending}
          </div>
          {activeLogin.user_code ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {copy.deviceCode}
              </span>
              <code className="rounded-md border border-border bg-background px-2 py-1 font-mono text-base tracking-wider">
                {activeLogin.user_code}
              </code>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      activeLogin.user_code || "",
                    );
                    onCopied(true);
                  } catch {
                    onCopied(false);
                  }
                }}
              >
                <ClipboardIcon className="size-3.5" />{" "}
                {copied ? copy.copied : copy.copyCode}
              </Button>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {activeLogin.auth_url || activeLogin.verification_url ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  void openSensitiveAuthorizationUrl(
                    activeLogin.auth_url || activeLogin.verification_url || "",
                  )
                }
              >
                <ExternalLinkIcon className="size-3.5" />{" "}
                {copy.openAuthorization}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={loginBusy === "cancel"}
              onClick={onCancelLogin}
            >
              {copy.cancelLogin}
            </Button>
          </div>
        </div>
      ) : null}

      {!authorizationOnly && (
        <details className="rounded-lg border border-border bg-muted/20 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">
            {copy.connectApiKey}
          </summary>
          <form
            className="mt-3 space-y-2"
            onSubmit={onSubmitApiKey}
            autoComplete="off"
          >
            <p className="text-xs leading-5 text-muted-foreground">
              {copy.reuseApiKeyHint}
            </p>
            <label className="block space-y-1.5 text-xs text-muted-foreground">
              <span>{copy.apiKeyLabel}</span>
              <Input
                name="api_key"
                type="password"
                required
                autoComplete="new-password"
                data-1p-ignore="true"
                data-lpignore="true"
                spellCheck={false}
                placeholder={copy.apiKeyPlaceholder}
              />
            </label>
            <p className="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
              <KeyRoundIcon className="mt-0.5 size-3.5 shrink-0" />{" "}
              {copy.apiKeyHint}
            </p>
            <Button type="submit" size="sm" disabled={busy || loginPending}>
              {loginBusy === "apiKey" ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <KeyRoundIcon className="size-3.5" />
              )}
              {copy.submitApiKey}
            </Button>
          </form>
        </details>
      )}
    </div>
  );
}
