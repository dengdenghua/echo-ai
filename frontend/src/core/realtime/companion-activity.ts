// Read-only companion projection of server-confirmed turns. Never starts work.
type Row = { task_id: string; thread_id: string; title: string; status: string; phase?: "thinking" | "working"; updated_at: string };
type RecordRow = { row: Row; owner: object; scope: string };
const rows = new Map<string, RecordRow>();
const text = (v: unknown, n = 160) => typeof v === "string" ? v.slice(0, n) : "";
const account = () => typeof sessionStorage === "undefined" ? "" : sessionStorage.getItem("echo_auth_token") || "";
const live = new Set(["running", "pending", "waiting_approval", "paused"]);

export function companionActivitySnapshot(): Row[] {
  const scope = account();
  for (const [id, value] of rows) if (value.scope !== scope) rows.delete(id);
  return [...rows.values()].map(({ row }) => ({ ...row }));
}
if (typeof window !== "undefined") {
  Object.defineProperty(window, "echoCompanionActivity", { configurable: true, value: companionActivitySnapshot });
}

export function createCompanionActivityObserver() {
  const owner = {}, scope = account();
  return {
    response(method: string, value: unknown) {
      if (method !== 'thread/resume' || account() !== scope) return;
      const snapshot = value as {thread?:{id?:string};turns?:{id?:string;status?:string;items?:{type?:string;text?:string}[]} } | undefined;
      const threadId = text(snapshot?.thread?.id);
      if (!threadId || !Array.isArray(snapshot?.turns)) return;
      for (const turn of snapshot.turns) {
        const id=text(turn.id), existing=rows.get(id);
        // Resume is server evidence, but opening old history is not a new success.
        if (!id || (turn.status !== 'inProgress' && !existing)) continue;
        this.notification({method:turn.status==='inProgress'?'turn/started':'turn/completed',params:{threadId,turn}});
        if (turn.status==='inProgress') {
          const item=turn.items?.filter((i:{type?:string})=>i.type!=='userMessage').at(-1);
          if(item)this.notification({method:'item/started',params:{threadId,turnId:id,item}});
        }
      }
    },
    notification(note: { method: string; params?: unknown }) {
      if (account() !== scope) return;
      if (["item/started", "item/completed", "item/agentMessage/delta", "item/reasoning/textDelta", "item/reasoning/summaryTextDelta"].includes(note.method)) {
        const p = note.params as {turnId?: string; threadId?: string; item?: {type?: string}} | undefined;
        const record = rows.get(text(p?.turnId));
        if (!record || record.scope !== scope || record.row.thread_id !== p?.threadId || !live.has(record.row.status)) return;
        const kind = p?.item?.type;
        const thinking = kind === "reasoning" || note.method.startsWith("item/reasoning/");
        const working = ["agentMessage", "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "webSearch", "computerToolCall", "toolCall"].includes(kind || "") || note.method === "item/agentMessage/delta";
        if (thinking || working) record.row = {...record.row, phase: thinking ? "thinking" : "working"};
        return;
      }
      if (!["turn/started", "turn/completed", "turn/interrupted"].includes(note.method)) return;
      const p = note.params as { threadId?: string; turnId?: string; turn?: { id?: string; threadId?: string; status?: string; items?: { type?: string; text?: string }[] } } | undefined;
      const turn = p?.turn, id = text(turn?.id || p?.turnId), thread = text(p?.threadId || turn?.threadId);
      if (!id || !thread) return;
      const old = rows.get(id)?.row;
      const raw = turn?.status;
      const status = note.method === "turn/interrupted" ? "disconnected" : note.method === "turn/started" ? "running" : ({ completed: "completed", failed: "failed", cancelled: "cancelled", canceled: "cancelled", interrupted: "disconnected", paused: "paused" } as Record<string, string>)[raw || ""] || "unknown";
      // Late replay of a start cannot resurrect a terminal run.
      if (old && !live.has(old.status) && old.status !== "disconnected" && status === "running") return;
      rows.set(id, { owner, scope, row: { task_id: id, thread_id: thread, title: text(turn?.items?.find(i => i.type === "userMessage")?.text, 100) || old?.title || "当前对话", status, phase: status === "running" ? old?.phase || "thinking" : undefined, updated_at: new Date().toISOString() } });
      while (rows.size > 100) rows.delete(rows.keys().next().value!);
    },
    disconnect() {
      for (const value of rows.values()) if (value.owner === owner && live.has(value.row.status)) value.row = { ...value.row, status: "disconnected", updated_at: new Date().toISOString() };
    },
  };
}
