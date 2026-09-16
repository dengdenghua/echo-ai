import { useEffect, useState } from "react";
import { AUTO_DESIGN_CAPABILITIES, resolveDesignCapabilities, type DesignCapabilities, type DesignCapabilityPlan } from "@/core/design/capabilities";

export function MediaModelSelectors({ value, onChange }: { value: DesignCapabilities; onChange: (value: DesignCapabilities) => void }) {
  const [catalog, setCatalog] = useState<DesignCapabilityPlan["media_models"]>();
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void resolveDesignCapabilities("", AUTO_DESIGN_CAPABILITIES, false, controller.signal)
      .then(plan => { if (!controller.signal.aborted) setCatalog(plan.media_models); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [revision]);
  return <div className="flex items-center gap-2">
    {(["image", "video"] as const).map(kind => {
      const key = `${kind}_model` as const;
      const label = kind === "image" ? "图片" : "视频";
      const entry = catalog?.[kind];
      return <label key={kind} className="flex h-8 items-center gap-1 text-xs text-muted-foreground">
        <span>{label}</span>
        <select aria-label={`${label}生成模型`} className="h-8 max-w-40 rounded-md bg-transparent px-1 text-foreground focus-visible:ring-2 focus-visible:ring-ring" value={value[key] ?? ""} onChange={event => onChange({ ...value, [key]: event.target.value || undefined })}>
          <option value="">自动{entry?.default ? ` · ${entry.default}` : ""}</option>
          {value[key] && !entry?.models.includes(value[key]!) && <option value={value[key]} disabled>{value[key]}（不可用）</option>}
          {entry?.models.map(id => <option key={id} value={id} disabled={!entry.available}>{id}{!entry.available ? "（未配置）" : ""}</option>)}
          {!entry?.models.length && <option disabled>{error ? "读取失败" : catalog ? "服务器未配置模型" : "加载中…"}</option>}
        </select>
      </label>;
    })}
    {error && <button type="button" className="text-xs underline" onClick={() => setRevision(n => n + 1)}>重新读取模型</button>}
  </div>;
}
