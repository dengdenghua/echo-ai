import type {
  InlineSubagentInfo,
  InlineSubagentStatus,
} from "./inline-subagent-helpers";

/** Merge message-derived (pre-derived) agents with live event agents into
 * one de-duplicated, re-indexed roster for InlineSubagentCards. */
export function mergeInlineSubagentLists(
  eventAgents: InlineSubagentInfo[],
  preparedAgents: InlineSubagentInfo[] | undefined,
): InlineSubagentInfo[] {
  // Step 1: Normalize preDerivedAgents — collapse anonymous runtime duplicates into named spec entries.
  // deriveSubagentsFromMessages() may produce two groups:
  //   (a) "named" entries from the batch `specs`/`agents`/`tasks` array (e.g. calculator/translator/analyst)
  //   (b) "anonymous/runtime" entries from subsequent per-agent delegate/spawn calls, which carry the
  //       real task text but have generic names like "general"/UUID. These are duplicates of (a) that
  //       hold the task payload — they must be MERGED INTO the named entries, not rendered separately.
  const GENERIC_NAMES = new Set([
    "general",
    "agent",
    "subagent",
    "worker",
    "assistant",
  ]);
  const isAnonymousRuntime = (a: InlineSubagentInfo): boolean => {
    if (!a.name) return true;
    const lower = a.name.toLowerCase();
    if (GENERIC_NAMES.has(lower)) return Boolean(a.task);
    if (
      lower.startsWith("subagent_spawn_") ||
      lower.startsWith("subagent-spawn-") ||
      lower.startsWith("runtime_subagent_")
    ) {
      return true;
    }
    if (a.id && a.id === a.name && /^[a-f0-9-]{8,}$/i.test(a.id))
      return Boolean(a.task);
    return false;
  };

  /** Merge src fields into dst (dst wins on name/avatar/role; src wins on task/progress/summary). */
  const mergeInto = (
    dst: InlineSubagentInfo,
    src: InlineSubagentInfo,
  ): InlineSubagentInfo => {
    // Live terminal state wins. A non-terminal live marker must not regress
    // a terminal result already present in the persisted message stream.
    const terminal = new Set<InlineSubagentStatus>(["done", "error"]);
    // Failure is sticky across persisted and live aliases. Historical
    // streams can contain a stale "finished/done" transport marker after
    // the member's real planner failure; that bookkeeping event must not
    // repaint a failed lane as successfully completed.
    const status: InlineSubagentStatus =
      src.status === "error" || dst.status === "error"
        ? "error"
        : terminal.has(src.status)
          ? src.status
          : terminal.has(dst.status)
            ? dst.status
            : src.status || dst.status;
    let progress: number | undefined;
    if (status === "done") progress = 1.0;
    else if (status === "error") progress = src.progress ?? dst.progress ?? 0.5;
    else progress = src.progress ?? dst.progress;
    return {
      ...dst,
      avatarUrl: dst.avatarUrl ?? src.avatarUrl,
      status,
      progress,
      task: dst.task || src.task,
      summary: dst.summary || src.summary,
      error: dst.error || src.error,
      filesTouchedCount: Math.max(dst.filesTouchedCount, src.filesTouchedCount),
      iterationCount: dst.iterationCount ?? src.iterationCount,
    };
  };

  // Build a cleaned, deduplicated base list from preDerivedAgents.
  let cleanedPres: InlineSubagentInfo[] = [];
  if (preparedAgents && preparedAgents.length > 0) {
    const namedPres: InlineSubagentInfo[] = [];
    const anonPres: InlineSubagentInfo[] = [];
    for (const a of preparedAgents) {
      if (isAnonymousRuntime(a)) anonPres.push(a);
      else namedPres.push(a);
    }

    // If anon count ≤ named count, fold them in by position (spawn order == spec order).
    // If anon count > named count (rare), fold as many as possible then append the rest.
    const mergedNamed = namedPres.map((n, i) =>
      anonPres[i] ? mergeInto(n, anonPres[i]) : n,
    );
    const unmatchedRuntime = anonPres
      .slice(namedPres.length)
      .filter((agent) => Boolean(agent.task))
      .map((agent, index) => ({
        ...agent,
        name: `子智能体 ${String(mergedNamed.length + index + 1).padStart(2, "0")}`,
      }));
    cleanedPres = [...mergedNamed, ...unmatchedRuntime];
  }

  // Step 2: Merge with live event agents.
  if (cleanedPres.length === 0) return eventAgents;
  if (eventAgents.length === 0) {
    // Re-index on the way out so badge numbers are 1..N.
    return cleanedPres.map((a, i) => ({ ...a, index: i }));
  }

  const preById = new Map(cleanedPres.map((a) => [a.id, a]));
  const preByName = new Map<string, InlineSubagentInfo>();
  for (const a of cleanedPres) {
    if (a.name) preByName.set(a.name.toLowerCase(), a);
    if (a.role) preByName.set(a.role.toLowerCase(), a);
  }
  const merged: InlineSubagentInfo[] = [];
  const seenPreIds = new Set<string>();

  // Match human-facing lifecycle records first. Runtime spawn markers often
  // arrive earlier in the stream; processing them first consumed positional
  // matches and left the real codenames as duplicate rows.
  const orderedEventAgents = [
    ...eventAgents.filter((agent) => !isAnonymousRuntime(agent)),
    ...eventAgents.filter(isAnonymousRuntime),
  ];

  for (let i = 0; i < orderedEventAgents.length; i++) {
    const ea = orderedEventAgents[i]!;
    let pre = preById.get(ea.id);
    if (!pre && ea.name) pre = preByName.get(ea.name.toLowerCase());
    if (!pre && ea.role) pre = preByName.get(ea.role.toLowerCase());
    // Positional fallback is only for anonymous runtime markers. Named
    // records must never steal another named agent's slot.
    if (!pre && isAnonymousRuntime(ea)) {
      pre = cleanedPres.find((candidate) => !seenPreIds.has(candidate.id));
    }

    if (pre) {
      seenPreIds.add(pre.id);
      const combined = mergeInto(pre, ea);
      // Keep pre's stable identity (id/name/avatar) but let ea's live data win for progress/status/task
      // when ea's status is more recent (done/error overrides running, but not vice-versa).
      const finalStatus: InlineSubagentStatus = combined.status;
      let finalProgress: number | undefined;
      if (finalStatus === "done") finalProgress = 1.0;
      else if (finalStatus === "error")
        finalProgress = ea.progress ?? pre.progress ?? 0.5;
      else finalProgress = ea.progress ?? pre.progress;

      merged.push({
        ...combined,
        id: pre.id,
        name: pre.name && pre.name !== pre.id ? pre.name : ea.name || pre.name,
        role: pre.role || ea.role,
        avatar: pre.avatar ?? ea.avatar,
        index: i,
        task: ea.task || pre.task,
        summary: ea.summary || pre.summary,
        status: finalStatus,
        progress: finalProgress,
      });
    } else {
      // A bare spawn marker without task/status detail is only transport
      // bookkeeping. A matching named lifecycle record already represents
      // it, so exposing the raw subagent_spawn_* id adds noise and inflates
      // the visible task count.
      if (isAnonymousRuntime(ea) && !ea.task && cleanedPres.length > 0) {
        continue;
      }
      merged.push({
        ...ea,
        name: isAnonymousRuntime(ea)
          ? `子智能体 ${String(merged.length + 1).padStart(2, "0")}`
          : ea.name,
        index: merged.length,
      });
    }
  }
  for (const pa of cleanedPres) {
    if (!seenPreIds.has(pa.id)) merged.push(pa);
  }
  return merged.map((a, i) => ({ ...a, index: i }));
}
