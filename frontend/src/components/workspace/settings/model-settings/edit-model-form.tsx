import {
  CheckCircle2Icon,
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  PlusIcon,
  WifiIcon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { swallow } from "@/core/utils/log";
import { authHeaders, jsonAuthHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";

import {
  parseHeadersText,
  validateBaseUrl,
  type TestStatus,
} from "./custom-models";
import {
  DefaultEffortSelect,
  type DefaultReasoningEffort,
} from "./default-effort-select";

/** The fields the edit form reads from a /api/config/custom-models row. */
interface EditableCustomModel {
  id?: string;
  name?: string;
  display_name?: string | null;
  models?: unknown;
  base_url?: string | null;
  supports_thinking?: boolean;
  default_reasoning_effort?: DefaultReasoningEffort | null;
  reasoning_efforts?: string[] | null;
  supports_vision?: boolean;
  enable_1m_context?: boolean;
  context_window?: number | null;
  has_api_key?: boolean;
}

// ── Edit model form ────────────────────────────────────────────
//
// On mount, fetches the model's full config via the /edit endpoint so
// every field is round-tripped from config.yaml instead of showing blank
// placeholders. The API key itself is never returned in cleartext — if
// it was stored as `$ENV_VAR` the form displays the variable name (safe)
// and the user can leave the field blank to keep it; typing a new value
// overrides. Literal keys are shown as a "•••" placeholder.
export function EditModelForm({
  modelName,
  onCancel,
  onSaved,
}: {
  modelName: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState("");
  // Open-ended list of upstream model ids this entry can dispatch
  // to. Index 0 is the picker default, index -1 is the strongest
  // slot for Auto mode's performance verdict. Mirrors the
  // ``models`` field on the custom-model entry.
  const [models, setModels] = useState<string[]>([""]);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyPlaceholder, setApiKeyPlaceholder] = useState(
    t.settings.model.apiKeyPlaceholder,
  );
  const [baseUrl, setBaseUrl] = useState("");
  const [thinking, setThinking] = useState(false);
  const [defaultReasoningEffort, setDefaultReasoningEffort] = useState<
    DefaultReasoningEffort | undefined
  >(undefined);
  const [reasoningEfforts, setReasoningEfforts] = useState<
    string[] | null | undefined
  >(undefined);
  const [vision, setVision] = useState(false);
  // True when the last connection test confirmed the model has no
  // vision — the toggle is then locked off until a new test says
  // otherwise.
  const [visionLocked, setVisionLocked] = useState(false);
  const [millionContext, setMillionContext] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [headersText, setHeadersText] = useState("");
  const [showHeaders, setShowHeaders] = useState(false);
  const [loading, setLoading] = useState(true);
  // Provider is derived from the Base URL — no manual entry. Anthropic
  // base URLs need their own protocol; everything else speaks
  // OpenAI-compatible. The chip surfaces what the runtime will actually
  // do with this entry, so the user can spot a wrong base URL early.
  const detectedProvider = (() => {
    const u = (baseUrl || "").toLowerCase();
    if (!u) return "—";
    if (u.includes("anthropic.com")) return "anthropic";
    if (u.includes("googleapis.com") || u.includes("generativelanguage"))
      return "gemini";
    if (u.includes("ollama") || /:11434(\b|\/)/.test(u)) return "ollama";
    return "openai";
  })();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testMessage, setTestMessage] = useState("");
  const [testLatency, setTestLatency] = useState<number | null>(null);

  // One-shot config fetch. Empty deps — the component remounts when a
  // different model is selected (key={modelName} at the call site).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Backend doesn't return api_key (stays on server). List
        // endpoint gives us everything else; we look up this model id.
        const res = await fetch(
          `${getBackendBaseURL()}/api/config/custom-models`,
          { headers: authHeaders() },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list: EditableCustomModel[] = (await res.json()).models;
        const d: EditableCustomModel =
          list.find((m) => m.id === modelName) ?? {};
        if (cancelled) return;
        setDisplayName(d.display_name || d.name || "");
        const rawModels: unknown[] = Array.isArray(d.models) ? d.models : [];
        const normalised = rawModels
          .map((m) => (typeof m === "string" ? m.trim() : ""))
          .filter((m) => m.length > 0);
        setModels(normalised.length > 0 ? normalised : [""]);
        setBaseUrl(d.base_url || "");
        setThinking(!!d.supports_thinking);
        setDefaultReasoningEffort(d.default_reasoning_effort ?? undefined);
        setReasoningEfforts(
          Array.isArray(d.reasoning_efforts) ? d.reasoning_efforts : undefined,
        );
        setVision(!!d.supports_vision);
        setMillionContext(
          d.enable_1m_context === true ||
            Number(d.context_window || 0) >= 1_000_000,
        );
        setHeadersText("");
        setShowHeaders(false);
        setApiKeyPlaceholder(
          d.has_api_key
            ? `••• · ${t.settings.model.keepApiKeyHint}`
            : t.settings.model.apiKeyPlaceholder,
        );
      } catch (e) {
        swallow(e);
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : t.settings.model.networkError,
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    modelName,
    t.settings.model.apiKeyPlaceholder,
    t.settings.model.keepApiKeyHint,
    t.settings.model.networkError,
  ]);

  const handleModelChange = (idx: number, value: string) => {
    setModels((prev) => prev.map((m, i) => (i === idx ? value : m)));
  };
  const handleModelAdd = () => {
    setModels((prev) => [...prev, ""]);
  };
  const handleModelRemove = (idx: number) => {
    setModels((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx),
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    // Drop empty rows before persisting so the backend never sees
    // a trailing blank in the models list. The UI still shows the
    // last row even if it's empty, so the user can keep typing.
    const cleanedModels = models
      .map((m) => m.trim())
      .filter((m) => m.length > 0);
    if (cleanedModels.length === 0) {
      setError(t.settings.model.modelList.empty);
      setSaving(false);
      return;
    }
    const baseUrlErr = validateBaseUrl(baseUrl);
    if (baseUrlErr) {
      setError(baseUrlErr);
      setSaving(false);
      return;
    }
    // Save is gated on the connection test: a model that can't be
    // reached is useless to persist. Re-run it here so a config change
    // made after a successful test can't slip through.
    const testError = await handleTest();
    if (testError) {
      setError(t.settings.model.saveRequiresTestPass + "：" + testError);
      setSaving(false);
      return;
    }
    const body: Record<string, unknown> = {};
    // Keep a display name on every entry. It is editable independently
    // of the stable connection id and the upstream model ids.
    body.display_name = displayName || modelName;
    if (apiKey) body.api_key = apiKey;
    if (baseUrl) body.base_url = baseUrl;
    body.supports_thinking = thinking;
    body.default_reasoning_effort = defaultReasoningEffort ?? null;
    body.supports_vision = vision;
    body.context_window = 256_000;
    body.enable_1m_context = millionContext;
    // Always send the full models list — backend normalises and
    // persists verbatim, replacing any prior binding.
    body.models = cleanedModels;
    // Always send default_headers so clearing the textarea clears the
    // persisted yaml entry. The backend treats {} as "remove the key".
    body.default_headers = parseHeadersText(headersText);

    try {
      const res = await fetch(
        `${getBackendBaseURL()}/api/config/custom-models/${encodeURIComponent(modelName)}`,
        {
          method: "PUT",
          headers: jsonAuthHeaders(),
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const data = await res.json();
        setError(data.detail || t.settings.model.updateFailed);
        return;
      }
      toast.success(t.settings.model.saveSuccess);
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t.settings.model.networkError);
    } finally {
      setSaving(false);
    }
  };

  // Returns null when the connection test passed, otherwise the error
  // message. ``handleSave`` calls this first and refuses to persist a
  // model that has not passed the test.
  const handleTest = async (): Promise<string | null> => {
    if (!baseUrl) {
      const msg = t.settings.model.fillRequiredBeforeTest;
      setTestStatus("fail");
      setTestMessage(msg);
      return msg;
    }
    const baseUrlErr = validateBaseUrl(baseUrl);
    if (baseUrlErr) {
      setTestStatus("fail");
      setTestMessage(baseUrlErr);
      return baseUrlErr;
    }
    setTestStatus("testing");
    setTestMessage("");
    setTestLatency(null);
    const started = performance.now();
    // Test against the first non-empty model id (the picker default).
    const firstModel =
      models.map((m) => m.trim()).find((m) => m.length > 0) || modelName;
    try {
      const res = await fetch(
        `${getBackendBaseURL()}/api/config/custom-models/test`,
        {
          method: "POST",
          headers: jsonAuthHeaders(),
          body: JSON.stringify({
            id: modelName,
            base_url: baseUrl,
            api_key: apiKey || undefined,
            model: firstModel,
            provider: baseUrl.includes("anthropic.com")
              ? "anthropic"
              : undefined,
            default_headers: parseHeadersText(headersText),
          }),
          // Test runs a text ping + a vision canary; give both probes
          // room even on slow reasoning models.
          signal: AbortSignal.timeout(20000),
        },
      );
      const latency = Math.round(performance.now() - started);
      setTestLatency(latency);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        const msg = data.error || `HTTP ${res.status}`;
        setTestStatus("fail");
        setTestMessage(msg);
        return msg;
      } else {
        setTestStatus("success");
        // Vision auto-detection from the test probe. A confirmed
        // ``false`` locks the toggle off; ``true`` enables + checks it.
        const visionNote =
          data.supports_vision === true
            ? t.settings.model.visionDetected
            : data.supports_vision === false
              ? t.settings.model.visionNotSupported
              : "";
        if (data.supports_vision === true) {
          setVision(true);
          setVisionLocked(false);
        } else if (data.supports_vision === false) {
          setVision(false);
          setVisionLocked(true);
        }
        setTestMessage(
          [data.message || t.settings.model.saveSuccess, visionNote]
            .filter(Boolean)
            .join(" · "),
        );
        return null;
      }
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : t.settings.model.networkError;
      setTestStatus("fail");
      setTestMessage(msg);
      return msg;
    }
  };

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="text-sm font-medium">
        {t.settings.model.editModelTitle(modelName)}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" />
          {t.common.loading}
        </div>
      ) : (
        <>
          <div>
            <label
              htmlFor="edit-model-display-name"
              className="text-xs text-muted-foreground"
            >
              {t.settings.model.displayName}
            </label>
            <Input
              id="edit-model-display-name"
              name="echo-edit-model-display-name"
              className="mt-1"
              autoComplete="off"
              data-1p-ignore="true"
              data-lpignore="true"
              data-form-type="other"
              placeholder={t.settings.model.displayNamePlaceholder}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">
                {t.settings.model.providerLabel}
              </label>
              <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm">
                <span className="font-mono">{detectedProvider}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {t.settings.model.providerAutoHint}
                </span>
              </div>
            </div>
            <div>
              <label
                htmlFor="edit-model-api-key"
                className="text-xs text-muted-foreground"
              >
                {t.settings.model.keepApiKeyHint}
              </label>
              <div className="relative">
                <Input
                  id="edit-model-api-key"
                  name="echo-edit-model-api-key"
                  className="pr-10"
                  type={showKey ? "text" : "password"}
                  autoComplete="new-password"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-form-type="other"
                  spellCheck={false}
                  placeholder={apiKeyPlaceholder}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <button
                  type="button"
                  aria-label={
                    showKey
                      ? t.settings.model.hideApiKey
                      : t.settings.model.showApiKey
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? (
                    <EyeOffIcon className="size-4" />
                  ) : (
                    <EyeIcon className="size-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">
              {t.settings.model.baseUrlLabel}
            </label>
            <Input
              placeholder={t.settings.model.baseUrlPlaceholder}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <label className="text-xs text-muted-foreground">
                {t.settings.model.modelList.label}
              </label>
              <span className="text-xs text-muted-foreground">
                {t.settings.model.modelList.hint}
              </span>
            </div>
            <ul className="space-y-1.5">
              {models.map((id, idx) => (
                <li
                  key={`edit-model-${idx}`}
                  className="flex items-center gap-1.5"
                >
                  <span
                    className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
                    title={
                      idx === 0
                        ? t.settings.model.modelList.label
                        : idx === models.length - 1
                          ? t.settings.model.modelList.label
                          : ""
                    }
                  >
                    {idx === 0 ? "★" : idx === models.length - 1 ? "▴" : "·"}
                  </span>
                  <Input
                    className="flex-1 font-mono text-xs"
                    placeholder={t.settings.model.modelList.label}
                    value={id}
                    onChange={(e) => handleModelChange(idx, e.target.value)}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-default text-muted-foreground transition-colors",
                      "hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive",
                      "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
                    )}
                    onClick={() => handleModelRemove(idx)}
                    disabled={loading || models.length <= 1}
                    title={t.settings.model.modelList.removeTooltip}
                    aria-label={t.settings.model.modelList.removeTooltip}
                  >
                    <XCircleIcon className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 w-full border-dashed"
              onClick={handleModelAdd}
              disabled={loading}
            >
              <PlusIcon className="mr-1 h-3 w-3" />{" "}
              {t.settings.model.modelList.addButton}
            </Button>
          </div>

          <div className="rounded-lg border border-border-default bg-muted/20">
            <button
              type="button"
              aria-expanded={showHeaders}
              onClick={() => setShowHeaders((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium hover:bg-muted/40"
            >
              <span>
                {t.settings.model.extraHeadersTitle}
                {(() => {
                  const n = Object.keys(parseHeadersText(headersText)).length;
                  return n > 0 ? ` (${n})` : "";
                })()}
              </span>
              <span className="text-xs text-muted-foreground">
                {showHeaders ? "▾" : "▸"}
              </span>
            </button>
            {showHeaders && (
              <div className="space-y-2 border-t border-border-default px-3 py-3">
                <textarea
                  value={headersText}
                  onChange={(e) => setHeadersText(e.target.value)}
                  placeholder={t.settings.model.extraHeadersPlaceholder}
                  spellCheck={false}
                  rows={3}
                  className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <p className="text-xs text-muted-foreground">
                  {t.settings.model.extraHeadersHint}
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center gap-2 pt-5">
              <Switch checked={thinking} onCheckedChange={setThinking} />{" "}
              <span className="text-xs">{t.settings.model.thinkingLabel}</span>
            </div>
            <div className="flex flex-col items-start gap-1 pt-5">
              <div className="flex items-center gap-2">
                <Switch
                  checked={vision}
                  onCheckedChange={setVision}
                  disabled={visionLocked}
                />{" "}
                <span className="text-xs">{t.settings.model.visionLabel}</span>
              </div>
              {visionLocked && (
                <span
                  className="text-xs leading-tight text-muted-foreground"
                  role="status"
                >
                  {t.settings.model.visionNotSupported}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 pt-5">
              <Switch
                checked={millionContext}
                onCheckedChange={setMillionContext}
              />{" "}
              <span className="text-xs">
                {t.settings.model.millionContextLabel}
              </span>
            </div>
          </div>

          <DefaultEffortSelect
            value={defaultReasoningEffort}
            reasoningEfforts={reasoningEfforts}
            onChange={setDefaultReasoningEffort}
          />

          {/* Test status + buttons */}
          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              {testStatus === "idle" && (
                <>
                  <div className="h-2.5 w-2.5 rounded-lg bg-muted-foreground/40" />
                  <span className="text-muted-foreground">
                    {t.settings.model.notTested}
                  </span>
                </>
              )}
              {testStatus === "testing" && (
                <>
                  <Loader2Icon className="h-4 w-4 animate-spin text-info" />
                  <span className="text-info">{t.common.loading}</span>
                </>
              )}
              {testStatus === "success" && (
                <>
                  <CheckCircle2Icon className="h-4 w-4 text-success" />
                  <span className="text-success">
                    {testMessage}
                    {testLatency != null ? ` (${testLatency}ms)` : ""}
                  </span>
                </>
              )}
              {testStatus === "fail" && (
                <>
                  <XCircleIcon className="h-4 w-4 text-destructive" />
                  <span className="text-destructive">{testMessage}</span>
                </>
              )}
              <span className="text-xs text-muted-foreground ml-2">
                {t.settings.model.testEndpointHint}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testStatus === "testing" || loading}
              >
                <WifiIcon className="mr-1 h-3 w-3" />{" "}
                {t.settings.model.testConnection}
              </Button>
            </div>
          </div>
        </>
      )}
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving || loading}>
          {saving ? t.common.loading : t.common.save}
        </Button>
      </div>
    </div>
  );
}
