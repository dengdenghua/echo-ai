import { useI18n } from "@/core/i18n/hooks";

// Per-model default reasoning effort, persisted via the custom-models
// API. Mirrors the backend vocabulary (off | high | max | none) and
// lets DeepSeek-style models default to deliberate thinking without
// every caller having to pass it explicitly.
export type DefaultReasoningEffort = "off" | "high" | "max" | "none";

function isDefaultReasoningEffort(
  value: string,
): value is DefaultReasoningEffort {
  return (
    value === "off" || value === "high" || value === "max" || value === "none"
  );
}

// The picker's UI vocabulary (off/low/medium/high/xhigh) is broader than the
// persisted default-effort vocabulary (off/high/max/none). Map a capability
// set down to the settings vocabulary so the "default reasoning effort"
// dropdown only offers tiers the model genuinely accepts on the wire.
function defaultEffortsForCapability(
  reasoningEfforts?: string[] | null,
): DefaultReasoningEffort[] | null {
  // No capability info → keep the full default set.
  if (!reasoningEfforts) return null;
  // Explicitly empty → no meaningful effort control (adaptive / unsupported
  // thinking) → callers hide the whole dropdown.
  if (reasoningEfforts.length === 0) return [];
  const map: Record<string, DefaultReasoningEffort> = {
    off: "off",
    low: "high",
    medium: "high",
    high: "high",
    xhigh: "max",
    max: "max",
  };
  const out: DefaultReasoningEffort[] = [];
  for (const tier of reasoningEfforts) {
    const mapped = map[tier];
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  // "none" (no injection) is always a valid meta-option.
  if (out.length === 0) return null;
  return out;
}

/** Lightweight client-side mirror of the backend's OpenAI-compatible profile
 *  resolution, used by the add-new form before an entry exists. Returns the
 *  picker-vocabulary tiers (off/low/medium/high/xhigh), null for the full
 *  default set, or [] when the profile has no meaningful effort control. */
export function clientSideReasoningEfforts(
  baseUrl: string,
  model: string,
): string[] | null {
  const url = (baseUrl || "").toLowerCase();
  const m = (model || "").toLowerCase();
  if (
    url.includes("api.deepseek.com") ||
    m.startsWith("deepseek-") ||
    m.includes("deepseek/")
  ) {
    return ["off", "high", "xhigh"];
  }
  if (
    url.includes("minimax") ||
    m.startsWith("minimax") ||
    m.startsWith("abab")
  ) {
    return [];
  }
  return null;
}

/** Capability-aware "default reasoning effort" select. Filters the options
 *  to the tiers the resolved model profile genuinely accepts; hides entirely
 *  when the model has no meaningful effort control (e.g. MiniMax adaptive).
 *  ``reasoningEfforts`` is the picker vocabulary (off/low/medium/high/xhigh). */
export function DefaultEffortSelect({
  value,
  reasoningEfforts,
  onChange,
}: {
  value: DefaultReasoningEffort | undefined;
  reasoningEfforts?: string[] | null;
  onChange: (v: DefaultReasoningEffort | undefined) => void;
}) {
  const { t } = useI18n();
  const offered = defaultEffortsForCapability(reasoningEfforts);
  // No meaningful tiers → no control to show.
  if (offered && offered.length === 0) return null;
  const options: DefaultReasoningEffort[] = offered ?? ["off", "high", "max"];
  const labelFor = (v: DefaultReasoningEffort) =>
    v === "off"
      ? t.settings.model.defaultReasoningEffortOff
      : v === "high"
        ? t.settings.model.defaultReasoningEffortHigh
        : t.settings.model.defaultReasoningEffortMax;
  return (
    <div className="mt-3 flex items-center justify-between rounded-lg border border-border px-3 py-2">
      <label
        htmlFor="default-reasoning-effort"
        className="text-xs text-muted-foreground"
      >
        {t.settings.model.defaultReasoningEffortLabel}
      </label>
      <select
        id="default-reasoning-effort"
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          // The options are "" (follow) and the effort values themselves.
          onChange(isDefaultReasoningEffort(v) ? v : undefined);
        }}
        className="rounded-md border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">
          {t.settings.model.defaultReasoningEffortFollow}
        </option>
        {options.map((v) => (
          <option key={v} value={v}>
            {labelFor(v)}
          </option>
        ))}
        <option value="none">
          {t.settings.model.defaultReasoningEffortNone}
        </option>
      </select>
    </div>
  );
}
