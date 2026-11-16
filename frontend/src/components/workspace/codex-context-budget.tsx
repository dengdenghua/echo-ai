import { useEffect, useState } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { CODEX_CONTEXT_BUDGET_CHANGED, readCodexContextBudget, saveCodexContextBudget } from "@/core/models/codex-context-budget";

export function CodexContextBudget({ model, disabled = false }: { model?: string | null; disabled?: boolean }) {
  const { user } = useAuth();
  const principal = user?.actor_id || user?.user_id || "local";
  const [budget, setBudget] = useState<number | undefined>();
  const [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => setBudget(readCodexContextBudget(principal, model || "auto"));
    refresh();
    window.addEventListener(CODEX_CONTEXT_BUDGET_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(CODEX_CONTEXT_BUDGET_CHANGED, refresh); window.removeEventListener("storage", refresh); };
  }, [principal, model]);
  return <section className="space-y-2 border-t border-border-subtle px-2 py-2 text-xs" aria-label="Codex 上下文预算">
    <label className="flex items-center justify-between gap-2">自动压缩预算
      <select aria-label="自动压缩预算" className="rounded-md border bg-background px-2 py-1" disabled={disabled || !model} value={budget ?? "auto"} onChange={event => {
        try { saveCodexContextBudget(principal, model || "auto", event.target.value === "auto" ? undefined : Number(event.target.value)); setError(""); }
        catch { setError("保存失败，请重试"); }
      }}>
        <option value="auto">跟随模型</option>
        {[32000,64000,100000,200000,300000,500000,1000000].map(value => <option key={value} value={value}>{value === 1000000 ? "1M" : `${value / 1000}K`}</option>)}
      </select>
    </label>
    <p className="text-muted-foreground">下次发送生效；实际压缩阈值受模型上限约束，不扩展上下文容量。</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </section>;
}
