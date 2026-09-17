import { useState } from "react";

import { CodexHotspotPanel } from "@/components/workspace/codex-hotspot-panel";
import { jsonAuthHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";

type Discovery = { base_url: string; models: string[] };

async function post<T>(
  path: string,
  body: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(`${getBackendBaseURL()}${path}`, {
    method,
    headers: jsonAuthHeaders(),
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as T & { detail?: string };
  if (!response.ok) throw new Error(result.detail ?? "热点连接失败");
  return result;
}

export function EchoModelHotspotSettings({
  onConnected,
  embedded = false,
}: {
  onConnected: () => void;
  embedded?: boolean;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [name, setName] = useState("同事的模型");
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [entryId, setEntryId] = useState(
    () => `echo_hotspot_${crypto.randomUUID()}`,
  );
  const invalidate = () => {
    setDiscovery(null);
    setModel("");
    setConnected(false);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "热点连接失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={embedded ? "space-y-4" : "space-y-4 rounded-lg border p-4"}
      aria-label="Echo 模型热点"
    >
      {!embedded && (
        <div>
          <h3 className="font-medium">个人共享</h3>
          <p className="text-sm text-muted-foreground">
            共享模型额度，或连接同事的热点。会话和本地工具继续在各自的 Echo
            中运行。
          </p>
        </div>
      )}
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          连接共享模型
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          填写同事提供的模型地址与邀请凭证，先验证可用模型，再添加。
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const found = await post<Discovery>("/api/a2a/hotspot/discover", {
                base_url: baseUrl,
                token,
              });
              setDiscovery(found);
              setModel(found.models[0] ?? "");
              setConnected(false);
            });
          }}
        >
          <label className="block text-sm">
            连接名称
            <input
              disabled={busy}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full rounded border bg-background p-2"
            />
          </label>
          <label className="block text-sm">
            模型地址
            <input
              disabled={busy}
              required
              type="url"
              placeholder="https://模型服务地址/v1"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                invalidate();
              }}
              className="mt-1 block w-full rounded border bg-background p-2"
            />
          </label>
          <label className="block text-sm">
            邀请凭证
            <input
              disabled={busy}
              required
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                invalidate();
              }}
              className="mt-1 block w-full rounded border bg-background p-2"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            地址须以 /v1 结尾。127.0.0.1
            仅用于已在本机建立的隧道，不能直接连接同事电脑。
          </p>
          <button
            disabled={busy || !token.trim() || !baseUrl.trim() || !name.trim()}
            type="submit"
            className="rounded border px-3 py-2 disabled:opacity-50"
          >
            {busy ? "处理中…" : "验证并读取模型"}
          </button>
        </form>
        {discovery && !discovery.models.length && (
          <p role="status" className="text-sm text-muted-foreground">
            连接已验证，但暂无可用模型。请联系分享者检查模型授权。
          </p>
        )}
        {discovery && discovery.models.length > 0 && (
          <div className="space-y-3">
            <label className="block text-sm">
              热点模型
              <select
                disabled={busy || connected}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="mt-1 block w-full rounded border bg-background p-2"
              >
                {discovery.models.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy || !model || connected}
              className="rounded border px-3 py-2 disabled:opacity-50"
              onClick={() =>
                void run(async () => {
                  const result = await post<{
                    _status?: { ok?: boolean; error?: string };
                  }>(
                    `/api/config/custom-models/${entryId}`,
                    {
                      name: name.trim() || "模型热点",
                      display_name: name.trim() || "模型热点",
                      provider: "openai",
                      base_url: discovery.base_url,
                      api_key: token,
                      models: [model],
                      wire_api: "responses",
                      codex_wire_api: "responses",
                      supports_tool_use: true,
                      compat_profile: "echo_hotspot",
                      omit_sampling_parameters: true,
                    },
                    "PUT",
                  );
                  if (result._status?.ok === false)
                    throw new Error(
                      result._status.error ?? "热点模型路由创建失败",
                    );
                  setConnected(true);
                  setToken("");
                  setEntryId(`echo_hotspot_${crypto.randomUUID()}`);
                  onConnected();
                })
              }
            >
              添加到 Echo 模型列表
            </button>
          </div>
        )}
      </details>
      <div className="border-t pt-3">
        <CodexHotspotPanel />
      </div>
      {connected && (
        <p role="status" className="text-sm">
          已添加。请在聊天的模型选择器中选择「{name}
          」。后续可在自定义模型列表修改或删除此连接。
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
