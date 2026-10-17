// Pure formatting helpers and tab routing for the observability page.

import { swallow } from "@/core/utils/log";

export function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch (e) {
    swallow(e);
    return String(v);
  }
}

export function shortTs(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString();
  } catch (e) {
    swallow(e);
    return ts;
  }
}

export function eventRowColor(kind: string): string {
  if (kind === "immune" || kind === "immune_reject") return "bg-destructive/5";
  if (kind.startsWith("budget")) return "bg-warning/5";
  if (kind === "file_op") return "bg-primary/5";
  if (kind === "browser_artifact") return "bg-chart-1/5";
  if (kind === "sub_tool_start" || kind === "sub_tool_end") return "bg-info/5";
  return "";
}

export type ObservabilityTab = "overview" | "events" | "resources" | "system";

export function normalizeObservabilityTab(tab: string): ObservabilityTab {
  switch (tab) {
    case "overview":
      return "overview";
    case "events":
    case "runs":
    case "swarm":
    case "blackboard":
    case "journal":
      return "events";
    case "resources":
    case "hemolymph":
    case "cost":
      return "resources";
    case "system":
    case "regeneration":
    case "diagnostics":
      return "system";
    default:
      return "overview";
  }
}
