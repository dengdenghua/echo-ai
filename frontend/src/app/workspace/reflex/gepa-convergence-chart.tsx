import { TrendingUpIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import type { Translations } from "@/core/i18n/locales/types";

import type { HistoryEntry } from "./gepa-types";

/* Implementation note. */
export function ConvergenceChart({
  history,
  t,
}: {
  history: HistoryEntry[];
  t: Translations;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  // Project history into (iter, child_avg, improved) triples,
  // skipping seed-row + skipped/early-stop markers (those have
  // no child_avg). Memoising would be nice but the array is
  // tiny · O(N) per render is fine.
  const points = history
    .filter(
      (h): h is HistoryEntry & { iter: number; child_avg: number } =>
        typeof h.iter === "number" &&
        typeof h.child_avg === "number" &&
        h.iter > 0,
    )
    .map((h) => ({
      iter: h.iter,
      score: h.child_avg,
      improved: !!h.improved,
    }));

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== w * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Padding for the in-canvas axis labels.
    const pad = { l: 28, r: 8, t: 8, b: 18 };
    const innerW = w - pad.l - pad.r;
    const innerH = h - pad.t - pad.b;

    // Always draw axes + baseline so the chart slot doesn't look
    // empty between runs.
    ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, pad.t + innerH);
    ctx.lineTo(pad.l + innerW, pad.t + innerH);
    ctx.stroke();

    // Axis labels (hand-rolled · no chart lib so the canvas stays
    // 100 LOC. Two y-grid ticks at 0.0 / 0.5 / 1.0 is enough for
    // a sparkline-sized chart).
    ctx.fillStyle = "rgba(148, 163, 184, 0.7)";
    ctx.font = "10px ui-sans-serif, system-ui";
    ctx.textBaseline = "middle";
    for (const v of [0, 0.5, 1]) {
      const y = pad.t + innerH - v * innerH;
      ctx.fillText(v.toFixed(1), 4, y);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + innerW, y);
      ctx.stroke();
    }

    if (points.length === 0) {
      ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
      // The empty-state line is Chinese: keep it on the 12px floor.
      ctx.font = "12px ui-sans-serif, system-ui";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(
        t.recipeForge.noIterationsYet,
        pad.l + innerW / 2,
        pad.t + innerH / 2,
      );
      return;
    }

    const maxIter = Math.max(...points.map((p) => p.iter));
    const xFor = (it: number) =>
      pad.l + (maxIter > 0 ? (it / maxIter) * innerW : innerW / 2);
    const yFor = (s: number) =>
      pad.t + innerH - Math.max(0, Math.min(1, s)) * innerH;

    // Best-so-far step line · monotone non-decreasing. ECHO has no
    // green: an improvement is the core "stable sync" colour.
    const core =
      getComputedStyle(c).getPropertyValue("--echo-core").trim() || "#08788a";
    ctx.strokeStyle = core;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let bestSoFar = -Infinity;
    points.forEach((p, i) => {
      bestSoFar = Math.max(bestSoFar, p.score);
      const x = xFor(p.iter);
      const y = yFor(bestSoFar);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        // Step shape · horizontal then vertical · matches the
        // "best-so-far" step semantics better than a smooth line.
        const prevX = xFor(points[i - 1]!.iter);
        ctx.lineTo(prevX, y);
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // Per-iter dots · core = improved front, gray = dominated.
    for (const p of points) {
      ctx.fillStyle = p.improved ? core : "rgba(148, 163, 184, 0.5)";
      ctx.beginPath();
      ctx.arc(xFor(p.iter), yFor(p.score), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // X-axis end label · just the max iter so we know the run length.
    ctx.fillStyle = "rgba(148, 163, 184, 0.7)";
    ctx.textBaseline = "top";
    ctx.textAlign = "right";
    ctx.fillText(`iter ${maxIter}`, pad.l + innerW, pad.t + innerH + 4);
  }, [points, t.recipeForge.noIterationsYet]);

  return (
    <div className="rounded-md border border-border-subtle bg-background/40 p-2">
      <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <TrendingUpIcon className="size-3" />
        Convergence · best-so-far (line) + per-iter score (dots)
      </div>
      <canvas ref={ref} className="h-[120px] w-full" />
    </div>
  );
}
