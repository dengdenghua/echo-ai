/**
 * Shared pieces of the Codex engine controls: profile labels, model
 * matching, the readiness explanation and small presentational parts.
 */
import { AlertTriangleIcon, CheckCircle2Icon } from "lucide-react";

import type { CoderModelProfile } from "@/core/coder/api";
import { useI18n } from "@/core/i18n/hooks";
import {
  coderEngineCopy,
  type CoderEngineCopy,
} from "@/core/i18n/locales/coder-engine";
import type { ReasoningEffort } from "@/core/threads";
import { cn } from "@/lib/utils";
import { type PickerModel } from "@/components/workspace/model-picker";

export async function openSensitiveAuthorizationUrl(
  url: string,
): Promise<boolean> {
  // Do not use the regular in-app URL router here: it persists its navigation
  // handoff in localStorage, while OAuth URLs can contain one-time state.
  if (!/^https?:\/\//i.test(url)) return false;
  if (window.echo?.app?.openExternal) {
    await window.echo.app.openExternal(url);
    return true;
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) opened.opener = null;
  return Boolean(opened);
}

export function profileLabel(
  profile: CoderModelProfile | undefined,
  copy: CoderEngineCopy,
) {
  if (!profile) return copy.triggerFallback;
  const source =
    profile.source === "follow_system"
      ? copy.followSystemShort
      : copy.accountModeShort;
  return profile.effective_model
    ? `${source} · ${profile.effective_model}`
    : source;
}

export function compactProfileLabel(
  profile: CoderModelProfile | undefined,
  copy: CoderEngineCopy,
) {
  if (!profile) return copy.triggerFallback;
  return (
    profile.effective_model ||
    (profile.source === "follow_system"
      ? copy.followSystemShort
      : copy.accountModeShort)
  );
}

export function reasoningLabel(effort: ReasoningEffort, locale: string) {
  const language = locale.toLowerCase().slice(0, 2);
  const labels: Record<ReasoningEffort, Record<string, string>> = {
    off: { zh: "关闭", ja: "オフ", ko: "끔", en: "Off" },
    minimal: { zh: "极低", ja: "最小", ko: "최소", en: "Minimal" },
    low: { zh: "低", ja: "低", ko: "낮음", en: "Low" },
    medium: { zh: "中", ja: "中", ko: "중간", en: "Medium" },
    high: { zh: "高", ja: "高", ko: "높음", en: "High" },
    xhigh: { zh: "极高", ja: "超高", ko: "매우 높음", en: "XHigh" },
    max: { zh: "最大", ja: "最大", ko: "최대", en: "Max" },
  };
  return labels[effort][language] ?? labels[effort].en;
}

export function pickerModelValue(model: PickerModel) {
  return model.selection_id || model.entry_id || model.name;
}

export function systemModelFamilyKey(model: PickerModel) {
  if (model.entry_id && model.model) {
    return `${model.entry_id}\u0000${model.model}`;
  }
  return model.name.replace(/::1m$/, "");
}

export function modelMatches(
  model: PickerModel,
  value: string | null | undefined,
) {
  if (!value) return false;
  return [
    model.selection_id,
    model.entry_id,
    model.name,
    model.model,
    model.id,
  ].includes(value);
}

export function isCoderSystemModel(model: PickerModel) {
  const identifiers = [
    model.name,
    model.model,
    model.entry_id,
    pickerModelValue(model),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLowerCase());
  return !identifiers.some((value) => isSystemOrchestratorModel(value));
}

export function isSystemOrchestratorModel(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return ["mix", "echo-mix", "echo-ai"].includes(normalized || "");
}

export function profileCanExecute(profile: CoderModelProfile) {
  return profile.compatible && profile.execution_available !== false;
}

export function profileProblem(profile: CoderModelProfile, locale: string) {
  const copy = coderEngineCopy(locale);
  if (!profile.compatible) {
    if (
      isSystemOrchestratorModel(
        profile.effective_model ||
          profile.selected_model ||
          profile.system_model,
      )
    ) {
      return copy.aliasHint;
    }
    if (
      profile.compatibility_reason?.includes("no exact Echo ModelRouter route")
    )
      return copy.routeHint;
    if (
      profile.compatibility_reason?.includes("Responses proxy is unavailable")
    )
      return copy.proxyHint;
    return profile.compatibility_reason || copy.incompatible;
  }
  if (profile.execution_available !== false) return null;
  const language = locale.toLowerCase().slice(0, 2);
  const reasons: Record<string, Record<string, string>> = {
    disabled: {
      zh: "Codex 引擎尚未启用。",
      ja: "Codexエンジンが有効になっていません。",
      ko: "Codex 엔진이 활성화되지 않았습니다.",
      en: "The Codex engine is disabled.",
    },
    not_installed: {
      zh: "Codex 还没安装：在 HUB「应用」的执行引擎里安装。",
      ja: "Codex はまだインストールされていません。HUB の「アプリ」の実行エンジンからインストールしてください。",
      ko: "Codex가 아직 설치되지 않았습니다. HUB '앱'의 실행 엔진에서 설치하세요.",
      en: "Codex is not installed yet. Install it under HUB Apps · Execution engines.",
    },
    executable_unavailable: {
      zh: "未找到 Codex 程序，请检查本地安装。",
      ja: "Codex実行ファイルが見つかりません。ローカルインストールを確認してください。",
      ko: "Codex 실행 파일을 찾을 수 없습니다. 로컬 설치를 확인하세요.",
      en: "Codex executable not found. Check the local installation.",
    },
    tools_unavailable: {
      zh: "执行工具尚未就绪，请检查后端服务。",
      ja: "実行ツールの準備ができていません。バックエンドサービスを確認してください。",
      ko: "실행 도구가 준비되지 않았습니다. 백엔드 서비스를 확인하세요.",
      en: "Execution tools are not ready. Check the backend service.",
    },
    account_required: {
      zh: "请先连接 ChatGPT / Codex 账号。",
      ja: "先にChatGPT / Codexアカウントを接続してください。",
      ko: "먼저 ChatGPT / Codex 계정을 연결하세요.",
      en: "Connect a ChatGPT / Codex account first.",
    },
    account_unavailable: {
      zh: "账号凭据暂不可用，请重新连接。",
      ja: "アカウント認証情報を利用できません。再接続してください。",
      ko: "계정 자격 증명을 사용할 수 없습니다. 다시 연결하세요.",
      en: "Account credentials are unavailable. Reconnect your account.",
    },
  };
  const reason = reasons[profile.execution_unavailable_reason || ""];
  return reason ? (reason[language] ?? reason.en) : copy.unavailable;
}

export function ProfileCompatibility({
  profile,
  compact = false,
}: {
  profile: CoderModelProfile;
  compact?: boolean;
}) {
  const { locale } = useI18n();
  const copy = coderEngineCopy(locale);
  const available = profileCanExecute(profile);
  // The compact row sits in the composer's model menu, where a first-time
  // user lands after picking Codex: "暂不可执行" alone does not say what to do.
  const problem = profileProblem(profile, locale);
  return (
    <div
      className={cn(
        "flex gap-2 rounded-lg border px-3 py-2 text-xs",
        available
          ? "border-success/20 bg-success/[0.06] text-success"
          : "border-warning/25 bg-warning/[0.06] text-warning",
      )}
    >
      {available ? (
        <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
      )}
      <div className="min-w-0">
        <div className="font-medium">
          {available ? copy.compatible : copy.unavailable}
        </div>
        {problem ? (
          <div
            className={cn(
              "mt-0.5 break-words text-current/80",
              compact && "leading-5",
            )}
          >
            {problem}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function UsageStat({
  label,
  value,
  locale,
}: {
  label: string;
  value: number | null | undefined;
  locale: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/60 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm font-medium">
        {typeof value === "number" ? value.toLocaleString(locale) : "—"}
      </div>
    </div>
  );
}
