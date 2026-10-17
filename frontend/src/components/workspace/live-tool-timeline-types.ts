import type { Translations } from "@/core/i18n/locales/types";

export type TimelineT = Pick<
  Translations,
  "liveTools" | "liveToolTimeline" | "messageGrouping" | "todoList"
>;

export interface LiveToolEvent {
  id: string;
  name: string;
  status: "running" | "done" | "error" | "waiting_approval" | "interrupted";
  /** Durable owning turn coordinates. `iteration` is an event-local
   * execution/ordering coordinate and must not be used to infer chat turns. */
  turnId?: string;
  turnIndex?: number;
  /** Why this failed, when the source event carried a reason. Kept separate
   * from `output` so a renderer can show the cause without stringifying and
   * truncating a whole payload. Only meaningful with status "error". */
  error?: string;
  startedAt: number;
  durationMs?: number;
  finishedAt?: number;
  iteration: number;
  agentId?: string;
  agentName?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  parentToolUseId?: string;
  subAgentRole?: string;
  /** Cute codename assigned at spawn time (e.g. "Spark-3a4"). Set on
   * sub-agent-attributable events so the workbench can group them
   * under one tile. */
  subagentCodename?: string;
  /** Emoji avatar derived from role. Falls back to 🤖 for unknown
   * roles. */
  subagentAvatar?: string;
  /** Real avatar image URL from the agent market ("我的安装"), when the
   * sub-agent's identity resolved to an installed role. Takes priority
   * over the emoji ``subagentAvatar``. */
  subagentAvatarUrl?: string;
  /** Authoritative role display name from the backend built-in role
   * catalog (``BUILTIN_ROLES``), e.g. "Code Reviewer". Absent for
   * free-form role labels the catalog doesn't recognise, in which case
   * the frontend falls back to its own name mapping. */
  subagentRoleDisplayName?: string;
  /** Authoritative role responsibility blurb from ``BUILTIN_ROLES``.
   * Same fallback semantics as ``subagentRoleDisplayName``. */
  subagentRoleDescription?: string;
  /** Lifecycle marker. Synthesised events carry these instead of a
   * tool name, so panels can render the spawn moment + finish stats
   * without waiting for the first real tool call. */
  lifecycle?: "spawned" | "finished";
  /** Set on lifecycle="finished" events. */
  iterationCount?: number;
  /** Set on lifecycle="finished" events. */
  filesTouched?: string[];
  thought?: string;
  observation?: string;
  /** True when name/input/output mention a report-style deliverable
   * (see core/threads/report-deliverable.ts). Precomputed at mapping
   * time so per-frame render never stringifies payloads. */
  isReportLike?: boolean;
  /** When the tool is recognized by the catalog but its group is
   * excluded by config (e.g. web_search under enable_web_skills=false),
   * this carries {group, config_flag} so the UI can render a one-click
   * "enable" prompt instead of a bare error. */
  capabilityDisabled?: { group: string; config_flag: string };
}
