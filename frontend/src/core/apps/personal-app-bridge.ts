import { untypedApi } from "@/core/api/request";
import type { AppTaskSnapshot } from "./personal-app-task";

export interface AppTaskRequest {
  kind: "ai" | "skill" | "plugin";
  target?: string;
  prompt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function appTaskRequest(value: unknown): AppTaskRequest {
  if (!isRecord(value)) throw new Error("Invalid task request");
  const kind = value.kind;
  if (kind !== "ai" && kind !== "skill" && kind !== "plugin")
    throw new Error("Unknown task kind");
  const prompt = value.prompt;
  if (
    typeof prompt !== "string" ||
    !prompt.trim() ||
    prompt.length > 10000
  )
    throw new Error("Task prompt must contain 1–10000 characters");
  const target = value.target;
  if (
    kind !== "ai" &&
    (typeof target !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(target))
  )
    throw new Error("A skill or plugin id is required");
  return {
    kind,
    prompt,
    ...(kind !== "ai" && typeof target === "string" ? { target } : {}),
  };
}

export interface AppBridgeOptions {
  frame: HTMLIFrameElement;
  channel: string;
  deploymentId: string;
  permissions: readonly string[];
  requestTask: (task: AppTaskRequest) => Promise<AppTaskSnapshot>;
  getTask: (taskId: string) => AppTaskSnapshot;
}

export function attachPersonalAppBridge(options: AppBridgeOptions): () => void {
  let disposed = false;
  const pending = new Set<string>();
  const seen = new Set<string>();
  const abort = new AbortController();
  let calls = 0;
  let windowStart = Date.now();

  const receive = async (event: MessageEvent) => {
    if (
      disposed ||
      !options.frame.contentWindow ||
      event.source !== options.frame.contentWindow ||
      event.origin !== "null"
    )
      return;
    const data = event.data;
    if (
      !data ||
      data.type !== "echo.app.request" ||
      data.channel !== options.channel ||
      typeof data.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(data.id)
    )
      return;
    const reply = (
      result: unknown,
      error?: { message: string; code?: string | number },
    ) => {
      if (!disposed)
        options.frame.contentWindow?.postMessage(
          {
            type: "echo.app.response",
            channel: options.channel,
            id: data.id,
            ...(error ? { error } : { result }),
          },
          "*",
        );
    };
    // Replayed mutations never execute twice within one viewer session.
    if (seen.has(data.id) || pending.has(data.id)) return;
    const mutation = !["storage.get", "task.get"].includes(data.method);
    if (Date.now() - windowStart > 60000) {
      calls = 0;
      windowStart = Date.now();
    }
    if (
      pending.size >= 16 ||
      (mutation && seen.size >= 1000) ||
      ++calls > 120
    ) {
      reply(null, { message: "App request limit reached", code: "rate_limit" });
      return;
    }
    // Polling is read-only; it must not consume the lifetime mutation ledger.
    if (mutation) seen.add(data.id);
    pending.add(data.id);
    try {
      const args = data.params;
      if (data.method === "task.get") {
        if (!options.permissions.includes("task.request"))
          throw new Error("task.request permission required");
        if (typeof args?.taskId !== "string" || args.taskId.length > 128)
          throw new Error("Invalid task id");
        reply(options.getTask(args.taskId));
        return;
      }
      if (data.method === "task.request") {
        if (!options.permissions.includes("task.request"))
          throw new Error("task.request permission required");
        reply(await options.requestTask(appTaskRequest(args)));
        return;
      }
      if (
        !["storage.get", "storage.set", "storage.delete"].includes(data.method)
      )
        throw new Error("Unsupported app method");
      if (!options.permissions.includes("app.storage"))
        throw new Error("app.storage permission required");
      if (
        !args ||
        typeof args.key !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(args.key)
      )
        throw new Error("Invalid app data key");
      const path = `/api/personal-apps/${encodeURIComponent(options.deploymentId)}/data/${encodeURIComponent(args.key)}`;
      const requestOptions = {
        reason: "Personal app bridge, authenticated and app-scoped.",
        signal: abort.signal,
      };
      if (data.method === "storage.get") {
        reply(await untypedApi.get(path, requestOptions));
      } else {
        if (!Number.isSafeInteger(args.revision) || args.revision < 0)
          throw new Error("Read the document revision before saving");
        const body = {
          expected_revision: args.revision,
          value: args.value ?? null,
          delete: data.method === "storage.delete",
        };
        if (new TextEncoder().encode(JSON.stringify(body)).length > 1024 * 1024)
          throw new Error("App data exceeds 1 MiB limit");
        reply(
          await untypedApi.put(path, {
            ...requestOptions,
            headers: { "X-Echo-App-Bridge": "1" },
            body,
          }),
        );
      }
    } catch (error) {
      reply(null, {
        message: error instanceof Error ? error.message : "App request failed",
        code:
          typeof error === "object" && error !== null && "status" in error
            ? Number(error.status)
            : "request_failed",
      });
    } finally {
      pending.delete(data.id);
    }
  };
  const onMessage = (event: MessageEvent) => {
    void receive(event);
  };
  window.addEventListener("message", onMessage);
  return () => {
    disposed = true;
    abort.abort();
    window.removeEventListener("message", onMessage);
  };
}

const APP_POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;

export function personalAppDocument(html: string, channel: string): string {
  // This script contains only an unprivileged per-frame channel id. Session
  // credentials stay in the parent; even the SDK's messages are checked there.
  const sdk = `<script>(()=>{const channel=${JSON.stringify(channel).replaceAll("<", "\\u003c")};const pending=new Map();const prefix=Math.random().toString(36).slice(2);let id=0;let ready=false;
  addEventListener('message',event=>{const d=event.data;if(event.source!==parent||!d||d.channel!==channel)return;if(d.type==='echo.app.ready'){if(!ready){ready=true;for(const p of pending.values())parent.postMessage(p.message,'*');}return;}if(d.type!=='echo.app.response')return;const p=pending.get(d.id);if(!p)return;clearTimeout(p.timer);pending.delete(d.id);if(d.error){const e=new Error(d.error.message);e.code=d.error.code;p.reject(e);}else p.resolve(d.result);});
  const call=(method,params)=>new Promise((resolve,reject)=>{if(pending.size>=16){reject(new Error('Too many pending requests'));return;}const key=prefix+'_'+String(++id);const timer=setTimeout(()=>{pending.delete(key);reject(new Error('App request timed out'));},method==='task.request'?300000:30000);const message={type:'echo.app.request',channel,id:key,method,params};pending.set(key,{resolve,reject,timer,message});if(ready)parent.postMessage(message,'*');});
  Object.defineProperty(window,'echo',{value:Object.freeze({storage:Object.freeze({get:key=>call('storage.get',{key}),set:(key,value,revision)=>call('storage.set',{key,value,revision}),delete:(key,revision)=>call('storage.delete',{key,revision})}),tasks:Object.freeze({request:task=>call('task.request',task),get:taskId=>call('task.get',{taskId}),wait:async taskId=>{const deadline=Date.now()+600000;while(true){const result=await call('task.get',{taskId});if(result.terminal)return result;if(Date.now()>=deadline)throw new Error('Task is still pending. Use tasks.get or open its conversation; do not resubmit.');await new Promise(resolve=>setTimeout(resolve,3000));}}})}),writable:false,configurable:false});})();</script>`;
  return APP_POLICY + sdk + html;
}
