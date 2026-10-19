import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiGet, apiPost } from "@/core/api/request";
import {
  parseCodeBuddyModels,
  parseCodeBuddyStatus,
} from "@/core/agents/codebuddy-status";
import { useI18n } from "@/core/i18n/hooks";
import { codeBuddyConnectionCopy } from "@/core/i18n/locales/model-sources";
import { useCanManageWorkbenches } from "@/core/workbench/workbench-permissions";
import { useOptionalAuth } from "@/providers/AuthProvider";

export function CodeBuddyConnection() {
  const { locale } = useI18n();
  const copy = codeBuddyConnectionCopy(locale);
  const client = useQueryClient();
  const canManage = useCanManageWorkbenches();
  const auth = useOptionalAuth();
  const principal = auth?.user?.actor_id || auth?.user?.user_id || "local";
  const status = useQuery({
    queryKey: ["codebuddy-settings-status", principal],
    queryFn: async ({ signal }) =>
      parseCodeBuddyStatus(
        await apiGet("/api/config/codebuddy/status", { signal }),
      ),
    staleTime: 10_000,
  });
  const models = useQuery({
    queryKey: ["codebuddy-models"],
    queryFn: async ({ signal }) =>
      parseCodeBuddyModels(
        await apiGet("/api/config/codebuddy/models", { signal }),
      ),
    enabled: status.data?.available === true,
    staleTime: 60_000,
  });
  const login = useMutation({
    mutationFn: () => apiPost("/api/config/codebuddy/login"),
  });
  const check = status.data?.capability_checks?.chat;
  const refresh = async () => {
    await Promise.all([
      status.refetch(),
      models.refetch(),
      client.invalidateQueries({ queryKey: ["codebuddy-status"] }),
    ]);
  };
  return (
    <div className="space-y-4">
      <p className="text-xs leading-5 text-muted-foreground">
        {copy.description}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="space-y-2">
          <h4 className="text-sm font-medium">{copy.authorization}</h4>
          <p role="status" className="text-xs text-muted-foreground">
            {status.isPending
              ? copy.checking
              : status.isError
                ? copy.unavailable
                : status.data?.available
                  ? copy.detected
                  : status.data?.reason}
          </p>
          {status.data?.available && (
            <p className="text-xs text-muted-foreground">
              {check?.state === "verified"
                ? copy.verified(check.model)
                : check?.state === "failed"
                  ? copy.callFailed
                  : copy.loginHint}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              disabled={
                !canManage ||
                !status.data?.login_launch_supported ||
                login.isPending
              }
              onClick={() => login.mutate()}
            >
              {login.isPending ? copy.opening : copy.signIn}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={status.isFetching || models.isFetching}
              onClick={() => void refresh()}
            >
              <RefreshCwIcon className="size-3.5" />
              {copy.refresh}
            </Button>
          </div>
          {login.isSuccess && (
            <p
              role="status"
              className="text-xs leading-5 text-muted-foreground"
            >
              {copy.loginOpened}
            </p>
          )}
          {login.isError && (
            <p role="alert" className="text-xs text-destructive">
              {login.error instanceof Error
                ? login.error.message
                : copy.loginFailed}
            </p>
          )}
          {!canManage && (
            <p className="text-xs text-muted-foreground">{copy.adminHint}</p>
          )}
          {status.data?.available && !status.data.login_launch_supported && (
            <p className="text-xs leading-5 text-muted-foreground">
              {copy.platformHint}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {copy.modelCount(models.data?.models.length ?? "—")}
          </p>
        </section>
        <section className="space-y-2 border-t border-border-subtle pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
          <h4 className="text-sm font-medium">{copy.creditsTitle}</h4>
          <p className="text-xs leading-5 text-muted-foreground">
            {copy.creditsDescription}
          </p>
          <Button asChild size="sm" variant="outline">
            <a
              href="https://www.codebuddy.cn/profile/plans-usage"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLinkIcon className="size-3.5" />
              {copy.viewCredits}
            </a>
          </Button>
          <a
            className="block text-xs text-muted-foreground underline underline-offset-4"
            href="https://www.codebuddy.cn/docs/cli/quickstart"
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.signInGuide}
          </a>
        </section>
      </div>
    </div>
  );
}
