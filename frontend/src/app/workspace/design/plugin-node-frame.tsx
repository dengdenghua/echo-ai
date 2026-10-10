"use client";

import { useEffect, useRef, type IframeHTMLAttributes } from "react";

import { authHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";

type PluginStateRequest = {
  type: "echo.plugin-state.request";
  requestId: string;
  action: "get" | "set" | "delete";
  key?: string;
  value?: unknown;
  expectedRevision?: number;
};

type ClipStudioRequest = {
  type: "echo.clip-studio.request";
  requestId: string;
  operation: "read" | "edit" | "history" | "diagnostics" | "export" | "file";
  body?: unknown;
};

const CLIP_ROUTES = {
  read: { suffix: "?view=full", method: "GET" },
  edit: { suffix: "/edit", method: "POST" },
  history: { suffix: "/history", method: "POST" },
  diagnostics: { suffix: "/diagnostics", method: "GET" },
  export: { suffix: "/export", method: "POST" },
  file: { suffix: "/export/file", method: "GET" },
} as const;

type PluginNodeFrameProps = Omit<
  IframeHTMLAttributes<HTMLIFrameElement>,
  "sandbox"
> & {
  projectId: string | null;
  pluginId: string;
  nodeId: string;
  onRequestClose?: () => void;
};

function requestError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "插件状态请求失败";
  const candidate = payload as { detail?: unknown };
  if (typeof candidate.detail === "string") return candidate.detail;
  return "插件状态请求失败";
}

/** An opaque-origin plugin frame with a capability-scoped state bridge.
 * The child never receives auth credentials and cannot select another
 * project, plugin or node namespace. */
export function PluginNodeFrame({
  projectId,
  pluginId,
  nodeId,
  src,
  onLoad,
  onRequestClose,
  ...iframeProps
}: PluginNodeFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    const handleMessage = async (
      event: MessageEvent<PluginStateRequest | ClipStudioRequest>,
    ) => {
      const target = frameRef.current?.contentWindow;
      if (!target || event.origin !== "null" || event.source !== target) return;
      if (
        (event.data as { type?: string } | null)?.type ===
        "echo.design.close-surface"
      ) {
        onRequestClose?.();
        return;
      }
      if (
        !["echo.plugin-state.request", "echo.clip-studio.request"].includes(
          event.data?.type,
        ) ||
        typeof event.data.requestId !== "string" ||
        event.data.requestId.length > 200
      )
        return;
      const request = event.data;
      const generation = frameGeneration.current;
      const reply = (payload: Record<string, unknown>) => {
        if (!active || frameGeneration.current !== generation) return;
        // Opaque origins require '*'. The destination is the exact source
        // window checked above; scoped state is never broadcast to a parent.
        target.postMessage(
          {
            type:
              request.type === "echo.clip-studio.request"
                ? "echo.clip-studio.response"
                : "echo.plugin-state.response",
            requestId: request.requestId,
            ...payload,
          },
          "*",
        );
      };
      if (!projectId) {
        reply({ ok: false, error: "请先将画布绑定到项目" });
        return;
      }
      try {
        if (request.type === "echo.clip-studio.request") {
          // Only the bundled editor can use these routes, and the parent
          // fixes the project. Never proxy a child-supplied URL or headers.
          if (
            pluginId !== "clip-studio" ||
            !Object.hasOwn(CLIP_ROUTES, request.operation)
          ) {
            reply({ ok: false, error: "无效的剪辑操作" });
            return;
          }
          const route = CLIP_ROUTES[request.operation];
          const response = await fetch(
            `${getBackendBaseURL()}/api/plugins/clip-studio/projects/${encodeURIComponent(projectId)}${route.suffix}`,
            {
              method: route.method,
              headers: { "Content-Type": "application/json", ...authHeaders() },
              ...(route.method === "POST"
                ? { body: JSON.stringify(request.body ?? {}) }
                : {}),
            },
          );
          const payload =
            request.operation === "file" && response.ok
              ? await response.blob()
              : await response.json();
          if (!response.ok) throw new Error(requestError(payload));
          reply({ ok: true, payload });
          return;
        }
        const base = `${getBackendBaseURL()}/api/design/projects/${encodeURIComponent(projectId)}/plugin-nodes/${encodeURIComponent(nodeId)}/state`;
        let response: Response;
        if (request.action === "get") {
          response = await fetch(
            `${base}?plugin_id=${encodeURIComponent(pluginId)}`,
            { headers: authHeaders() },
          );
        } else if (
          request.action === "set" &&
          typeof request.key === "string" &&
          request.key
        ) {
          response = await fetch(`${base}/${encodeURIComponent(request.key)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
              plugin_id: pluginId,
              expected_revision: request.expectedRevision ?? 0,
              value: request.value,
            }),
          });
        } else if (
          request.action === "delete" &&
          typeof request.key === "string" &&
          request.key
        ) {
          const params = new URLSearchParams({
            plugin_id: pluginId,
            expected_revision: String(request.expectedRevision ?? 0),
          });
          response = await fetch(
            `${base}/${encodeURIComponent(request.key)}?${params}`,
            { method: "DELETE", headers: authHeaders() },
          );
        } else {
          reply({ ok: false, error: "无效的插件状态操作" });
          return;
        }
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(requestError(payload));
        reply({ ok: true, payload });
      } catch (error) {
        reply({
          ok: false,
          error: error instanceof Error ? error.message : "插件状态请求失败",
        });
      }
    };
    const onMessage = (
      event: MessageEvent<PluginStateRequest | ClipStudioRequest>,
    ) => void handleMessage(event);
    window.addEventListener("message", onMessage);
    return () => {
      active = false;
      window.removeEventListener("message", onMessage);
    };
  }, [nodeId, pluginId, projectId, src, onRequestClose]);

  return (
    <iframe
      ref={frameRef}
      src={src}
      {...iframeProps}
      sandbox="allow-scripts allow-downloads"
      onLoad={(event) => {
        frameGeneration.current += 1;
        onLoad?.(event);
      }}
    />
  );
}
