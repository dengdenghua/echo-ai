import { engineMegabytes, engineProgress, type EngineStatus } from "./api";
import type { EngineStoreCopy } from "@/core/i18n/locales/engine-store";

export type EngineStatusTone = "muted" | "primary" | "destructive";

/** The one line under an engine's name: what it is now, or how the install went. */
export function engineStatusLine(
  engine: EngineStatus,
  copy: EngineStoreCopy,
): { text: string; tone: EngineStatusTone } {
  const job = engine.job;
  if (engine.state === "installing") {
    if (job?.state === "installing") {
      return { text: copy.unpacking, tone: "primary" };
    }
    const source = copy.sources[job?.source ?? "mirror"];
    return {
      text: copy.downloading(engineProgress(engine), source),
      tone: "primary",
    };
  }
  if (job?.state === "failed") {
    // Error codes come from the backend; unknown ones read as a failed install.
    const errors: Partial<Record<string, string>> = copy.errors;
    return {
      text: errors[job.error ?? ""] ?? copy.errors.install_failed,
      tone: "destructive",
    };
  }
  if (!engine.supported) return { text: copy.unsupported, tone: "muted" };
  if (engine.state === "update_available") {
    return { text: copy.updateAvailable(engine.version), tone: "primary" };
  }
  if (engine.state === "ready") {
    const text =
      engine.source === "bundled"
        ? copy.bundled(engine.version)
        : engine.source === "configured"
          ? copy.configured
          : engine.source === "system"
            ? copy.system
            : copy.ready(engine.installed_version ?? engine.version);
    return { text, tone: "muted" };
  }
  return {
    text: `${copy.notInstalled} · ${copy.size(engineMegabytes(engine.download_size))}`,
    tone: "muted",
  };
}

/** Whether the store has something to install for this engine here. */
export function engineNeedsInstall(engine: EngineStatus | undefined): boolean {
  return Boolean(
    engine?.supported &&
    (engine.state === "not_installed" || engine.state === "update_available"),
  );
}
