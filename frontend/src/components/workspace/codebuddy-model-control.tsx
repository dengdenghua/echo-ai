import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { apiGet } from "@/core/api/request";
import { parseCodeBuddyModels } from "@/core/agents/codebuddy-status";
import { useI18n } from "@/core/i18n/hooks";

/** Model IDs come from the installed official CLI, never Echo's API catalog. */
export function CodeBuddyModelControl({
  value,
  onChange,
  disabled,
}: {
  value?: string;
  onChange?: (model: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const { data } = useQuery({
    queryKey: ["codebuddy-models"],
    queryFn: async ({ signal }) =>
      parseCodeBuddyModels(await apiGet("/api/config/codebuddy/models", { signal })),
    staleTime: 60_000,
  });
  const selected = value?.startsWith("codebuddy/") ? value : "auto";
  useEffect(() => {
    if (value && value !== "auto" && !value.startsWith("codebuddy/"))
      onChange?.("auto");
  }, [value, onChange]);
  const models = [
    ...new Set([
      ...(data?.models ?? []).map((model) => `codebuddy/${model}`),
      ...(selected !== "auto" ? [selected] : []),
    ]),
  ];
  return (
    <select
      aria-label="CodeBuddy"
      className="min-w-0 max-w-44 rounded-md bg-transparent px-2 py-1 text-ui"
      value={selected}
      onChange={(event) => onChange?.(event.target.value)}
      disabled={disabled}
    >
      <option value="auto">CodeBuddy · {t.modelPicker.autoModelLabel}</option>
      {models.map((model) => (
        <option key={model} value={model}>
          {model.slice("codebuddy/".length)}
        </option>
      ))}
    </select>
  );
}
