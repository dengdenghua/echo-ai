import {
  CheckCircle2Icon,
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  PlusIcon,
  WifiIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RoutedWebLink } from "@/components/ui/routed-web-link";
import { cn } from "@/lib/utils";
import { jsonAuthHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { modelSettingsPageCopy } from "@/core/i18n/locales/model-settings";

import { AdvancedDisclosure } from "./advanced-disclosure";
import {
  parseHeadersText,
  validateBaseUrl,
  type TestStatus,
} from "./custom-models";
import {
  clientSideReasoningEfforts,
  DefaultEffortSelect,
  type DefaultReasoningEffort,
} from "./default-effort-select";
import { PROTOCOLS, PROVIDERS } from "./providers";

// ── Add model form ─────────────────────────────────────────────
export function AddModelForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t, locale } = useI18n();
  const pageCopy = modelSettingsPageCopy(locale);
  const getProviderLabel = (value: string): string => {
    switch (value) {
      case "zhipu":
        return t.settings.model.providers.zhipu;
      case "aliyun":
        return t.settings.model.providers.aliyun;
      case "tencent":
        return t.settings.model.providers.tencent;
      case "volcengine":
        return t.settings.model.providers.volcengine;
      default:
        return PROVIDERS.find((p) => p.value === value)?.label ?? value;
    }
  };
  const [provider, setProvider] = useState("openai");
  const [protocol, setProtocol] = useState("openai");
  // Open-ended list of upstream model ids — matches the edit form
  // shape. Index 0 is the picker default, index -1 is the strongest
  // slot for Auto mode.
  const [models, setModels] = useState<string[]>([""]);
  const [displayName, setDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [thinking, setThinking] = useState(false);
  const [defaultReasoningEffort, setDefaultReasoningEffort] = useState<
    DefaultReasoningEffort | undefined
  >(undefined);
  const [vision, setVision] = useState(false);
  // True when the last connection test confirmed the model has no
  // vision — the toggle is then locked off until a new test says
  // otherwise.
  const [visionLocked, setVisionLocked] = useState(false);
  const [millionContext, setMillionContext] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testMessage, setTestMessage] = useState("");
  const [testLatency, setTestLatency] = useState<number | null>(null);
  // Extra HTTP headers. Stored as freeform text so users can paste
  // multiple lines; parsed into a dict only when submitting.
  const [headersText, setHeadersText] = useState("");
  const [showHeaders, setShowHeaders] = useState(false);

  const handleProviderChange = (value: string) => {
    setProvider(value);
    const preset = PROVIDERS.find((p) => p.value === value);
    if (preset) {
      setBaseUrl(preset.baseUrl);
      setProtocol(preset.protocol);
    }
  };

  const handleModelChange = (idx: number, value: string) => {
    setModels((prev) => prev.map((m, i) => (i === idx ? value : m)));
    if (/glm-5\.2|deepseek-v4-(flash|pro)/i.test(value)) {
      setMillionContext(true);
    }
  };
  const handleModelAdd = () => {
    setModels((prev) => [...prev, ""]);
  };
  const handleModelRemove = (idx: number) => {
    setModels((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx),
    );
  };

  // Returns null when the connection test passed, otherwise the error
  // message. ``handleSave`` calls this first and refuses to persist a
  // model that has not passed the test.
  const handleTest = async (): Promise<string | null> => {
    const firstModel = models.map((m) => m.trim()).find((m) => m.length > 0);
    if (!apiKey || !baseUrl || !firstModel) {
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
    try {
      const res = await fetch(
        `${getBackendBaseURL()}/api/config/custom-models/test`,
        {
          method: "POST",
          headers: jsonAuthHeaders(),
          body: JSON.stringify({
            provider: protocol === "anthropic" ? "anthropic" : "openai",
            base_url: baseUrl,
            api_key: apiKey,
            model: firstModel,
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

  const handleSave = async () => {
    const cleanedModels = models
      .map((m) => m.trim())
      .filter((m) => m.length > 0);
    if (!apiKey || !baseUrl || cleanedModels.length === 0) {
      setError(
        cleanedModels.length === 0
          ? t.settings.model.modelList.empty
          : t.settings.model.requiredFields,
      );
      return;
    }
    setSaving(true);
    setError("");
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
    // The first non-empty model id doubles as the entry id, since
    // ids have to be filename-safe and the picker shows the model
    // name the user just typed. Same convention as the previous
    // single-model layout. We already early-returned when
    // ``cleanedModels`` is empty, so index 0 is safe.
    const firstModel = cleanedModels[0] ?? "";
    const id = firstModel.replace(/[^a-zA-Z0-9._-]/g, "-");
    try {
      const res = await fetch(
        `${getBackendBaseURL()}/api/config/custom-models/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          headers: jsonAuthHeaders(),
          body: JSON.stringify({
            name: id,
            display_name: displayName || firstModel,
            provider: protocol === "anthropic" ? "anthropic" : "openai",
            base_url: baseUrl,
            api_key: apiKey,
            models: cleanedModels,
            supports_thinking: thinking,
            default_reasoning_effort: defaultReasoningEffort ?? null,
            supports_vision: vision,
            context_window: 256_000,
            enable_1m_context: millionContext,
            default_headers: parseHeadersText(headersText),
          }),
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

  return (
    <form
      className="space-y-3 rounded-lg border border-border p-4 sm:p-5"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      <h3 className="text-sm font-semibold">{pageCopy.addApiModel}</h3>

      <div>
        <label htmlFor="add-model-provider" className="text-sm font-medium">
          <span className="text-destructive">*</span>{" "}
          {t.settings.model.provider}
        </label>
        <select
          id="add-model-provider"
          name="echo-model-provider"
          className="mt-1 flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value)}
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {getProviderLabel(p.value)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-sm font-medium">
          <span className="text-destructive">*</span>{" "}
          {t.settings.model.modelList.label}
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t.settings.model.modelList.hint}
        </p>
        <ul className="mt-2 space-y-1.5">
          {models.map((id, idx) => (
            <li key={`add-model-${idx}`} className="flex items-center gap-1.5">
              <span className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {idx === 0 ? "★" : idx === models.length - 1 ? "▴" : "·"}
              </span>
              <Input
                name={`echo-model-id-${idx}`}
                autoComplete="off"
                data-1p-ignore="true"
                data-lpignore="true"
                aria-label={`${t.settings.model.modelList.label} ${idx + 1}`}
                className="flex-1 font-mono text-xs"
                placeholder={
                  idx === 0
                    ? t.settings.model.modelIdPlaceholder
                    : t.settings.model.modelIdPlaceholder
                }
                value={id}
                onChange={(e) => handleModelChange(idx, e.target.value)}
              />
              <button
                type="button"
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-default text-muted-foreground transition-colors",
                  "hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive",
                  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
                )}
                onClick={() => handleModelRemove(idx)}
                disabled={models.length <= 1}
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
        >
          <PlusIcon className="mr-1 h-3 w-3" />{" "}
          {t.settings.model.modelList.addButton}
        </Button>
        {/* Click-to-fill suggested model IDs · lets users skip
            "go look up the exact model name" · each chip populates
            the FIRST row of the models list. Renders only when the
            current preset ships a suggestion list. */}
        {(() => {
          const preset = PROVIDERS.find((p) => p.value === provider);
          if (!preset?.suggestedModels?.length) return null;
          return (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {preset.suggestedModels.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleModelChange(0, m)}
                  className="rounded-md border border-border-default bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  title={t.settings.model.fillModelId ?? "Fill this model ID"}
                >
                  {m}
                </button>
              ))}
            </div>
          );
        })()}
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="add-model-api-key" className="text-sm font-medium">
            <span className="text-destructive">*</span>{" "}
            {getProviderLabel(provider) || t.settings.model.provider}{" "}
            {t.settings.model.apiKey}
          </label>
          {/* Console link · opens the provider's dashboard in a
                new tab so users don't have to hunt for the API
                key page. Renders only when the preset carries one. */}
          {(() => {
            const preset = PROVIDERS.find((p) => p.value === provider);
            if (!preset?.consoleUrl) return null;
            return (
              <RoutedWebLink
                href={preset.consoleUrl}
                openTargetSource="model-provider-console"
                className="text-xs text-primary hover:underline font-normal"
              >
                {t.settings.model.getApiKey}
              </RoutedWebLink>
            );
          })()}
        </div>
        <div className="relative mt-1">
          <Input
            id="add-model-api-key"
            name="echo-new-model-api-key"
            className="pr-10"
            type={showKey ? "text" : "password"}
            autoComplete="new-password"
            data-1p-ignore="true"
            data-lpignore="true"
            data-form-type="other"
            spellCheck={false}
            placeholder={t.settings.model.apiKeyPlaceholder}
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

      <div>
        <label htmlFor="add-model-base-url" className="text-sm font-medium">
          <span className="text-destructive">*</span>{" "}
          {t.settings.model.baseUrlLabel}
        </label>
        <Input
          id="add-model-base-url"
          name="echo-model-base-url"
          autoComplete="url"
          className="mt-1"
          placeholder={t.settings.model.baseUrlPlaceholder}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </div>

      <AdvancedDisclosure
        title={pageCopy.formAdvancedTitle}
        description={pageCopy.formAdvancedSubtitle}
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="add-model-display-name"
              className="text-sm font-medium"
            >
              {t.settings.model.displayName}
            </label>
            <Input
              id="add-model-display-name"
              name="echo-model-display-name"
              autoComplete="off"
              data-1p-ignore="true"
              data-lpignore="true"
              data-form-type="other"
              className="mt-1"
              placeholder={t.settings.model.displayNamePlaceholder}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="add-model-protocol" className="text-sm font-medium">
              {t.settings.model.apiProtocol}
            </label>
            <select
              id="add-model-protocol"
              name="echo-model-protocol"
              className="mt-1 flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
            >
              {PROTOCOLS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {/* Extra HTTP headers — collapsed by default to keep the form
          uncluttered for the 95% case. Needed for APIs that gate on
          User-Agent (Kimi Coding) or require custom routing headers. */}
          <div className="rounded-lg border border-border-default bg-muted/20">
            <button
              type="button"
              aria-expanded={showHeaders}
              onClick={() => setShowHeaders((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/40"
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex items-center gap-2">
              <Switch
                aria-label={t.settings.model.thinkingLabel}
                checked={thinking}
                onCheckedChange={setThinking}
              />{" "}
              <span className="text-sm">{t.settings.model.thinkingLabel}</span>
            </div>
            <div className="flex flex-col items-start gap-1">
              <div className="flex items-center gap-2">
                <Switch
                  aria-label={t.settings.model.visionLabel}
                  checked={vision}
                  onCheckedChange={setVision}
                  disabled={visionLocked}
                />{" "}
                <span className="text-sm">{t.settings.model.visionLabel}</span>
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
            <div className="flex items-center gap-2">
              <Switch
                aria-label={t.settings.model.millionContextLabel}
                checked={millionContext}
                onCheckedChange={setMillionContext}
              />{" "}
              <span className="text-sm">
                {t.settings.model.millionContextLabel}
              </span>
            </div>
          </div>

          <DefaultEffortSelect
            value={defaultReasoningEffort}
            reasoningEfforts={clientSideReasoningEfforts(
              baseUrl,
              models[0] || "",
            )}
            onChange={setDefaultReasoningEffort}
          />
        </div>
      </AdvancedDisclosure>

      {/* Test status + buttons */}
      <div className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="status"
          className="flex min-w-0 flex-wrap items-center gap-2 text-sm"
        >
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
        <div className="flex gap-2 self-end sm:self-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testStatus === "testing"}
          >
            <WifiIcon className="mr-1 h-3 w-3" />
            {t.settings.model.testConnection}
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? t.common.loading : t.common.save}
        </Button>
      </div>
    </form>
  );
}
