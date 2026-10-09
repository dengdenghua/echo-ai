import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Upload } from "lucide-react";
import { mailboxRequest as api } from "@/core/mailbox/api";

type Config = { configured: boolean; local: boolean };
type Flow = { flow_id: string; authorization_url: string };
const message = (error: unknown) =>
  error instanceof Error ? error.message : "连接失败，请重试。";

export function GoogleMailboxConnect({
  onConnected,
}: {
  onConnected: () => void;
}) {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [flow, setFlow] = useState<Flow | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  useEffect(() => {
    let active = true;
    void api<Config>("/google/config")
      .then((data) => {
        if (active) setConfig(data);
      })
      .catch((err) => {
        if (active) setError(message(err));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!flow) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let completed = false;
    const poll = async () => {
      try {
        const result = await api<{ status: string; error: string }>(
          `/google/flows/${flow.flow_id}`,
        );
        if (!active) return;
        if (result.status === "connected") {
          completed = true;
          setFlow(null);
          onConnectedRef.current();
          return;
        }
        if (!["pending", "exchanging"].includes(result.status)) {
          completed = true;
          setFlow(null);
          setError(result.error || "授权已取消或过期，请重新连接。");
          return;
        }
        timer = setTimeout(() => void poll(), 1500);
      } catch (err) {
        if (active) {
          setError(message(err));
          setFlow(null);
        }
      }
    };
    timer = setTimeout(() => void poll(), 1500);
    return () => {
      active = false;
      clearTimeout(timer);
      if (!completed)
        void api(`/google/flows/${flow.flow_id}`, { method: "DELETE" }).catch(
          () => {},
        );
    };
  }, [flow]);

  const openGoogle = async (url: string) => {
    if (window.echo?.app?.openExternal) await window.echo.app.openExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api<Flow>("/google/start", { method: "POST" });
      setFlow(result);
      await openGoogle(result.authorization_url);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  const importClient = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 32768)
        throw new Error("请选择 Google 下载的 OAuth 客户端 JSON，最大 32 KB。");
      const parsed = JSON.parse(await file.text()) as {
        installed?: { client_id?: string; client_secret?: string };
      };
      if (!parsed.installed?.client_id || !parsed.installed?.client_secret)
        throw new Error(
          "需要“桌面应用”类型的 OAuth 客户端 JSON；网页应用和服务账号不适用。",
        );
      await api("/google/config", {
        method: "PUT",
        body: {
          client_id: parsed.installed.client_id,
          client_secret: parsed.installed.client_secret,
        },
      });
      setConfig((current) =>
        current ? { ...current, configured: true } : null,
      );
    } catch (err) {
      setError(
        err instanceof SyntaxError ? "文件不是有效的 JSON。" : message(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mail-google-connect" aria-label="Google 授权连接">
      <button
        className="mail-google-button"
        disabled={!config?.configured || !config.local || busy || !!flow}
        onClick={() => void connect()}
      >
        {busy || flow ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <span aria-hidden="true" className="mail-google-letter">
            G
          </span>
        )}
        {flow ? "等待 Google 授权…" : "使用 Google 账号连接"}
      </button>
      <p>
        在系统浏览器登录并授权，Echo 无需你的 Google 登录密码或应用专用密码。
      </p>
      {config && !config.local && (
        <p role="alert" className="mail-error">
          请在运行 Echo 后端的电脑上打开本机 Echo，再进行 Google 授权。
        </p>
      )}
      {flow && (
        <div className="mail-oauth-wait">
          <p>
            请在 Google 页面选择账号并允许邮箱访问。完成后此窗口会自动更新。
          </p>
          <button
            onClick={() =>
              void openGoogle(flow.authorization_url).catch((err) =>
                setError(message(err)),
              )
            }
          >
            <ExternalLink size={14} />
            重新打开授权页面
          </button>
          <button onClick={() => setFlow(null)}>取消连接</button>
        </div>
      )}
      {error && (
        <p role="alert" className="mail-error">
          {error}
        </p>
      )}
      {config && (
        <details open={!config.configured} className="mail-oauth-setup">
          <summary>
            {config.configured
              ? "Google 客户端已配置 · 更换配置"
              : "首次使用：配置 Echo 的 Google 客户端"}
          </summary>
          <ol>
            <li>
              在 Google Cloud 创建项目，配置 OAuth
              同意屏幕；个人使用可选“外部”，把自己的 Gmail 加入测试用户。
            </li>
            <li>
              创建 OAuth 客户端，应用类型选择「桌面应用」，下载 JSON 文件。
            </li>
            <li>导入文件，再点击上方「使用 Google 账号连接」。</li>
          </ol>
          <a
            href="https://console.cloud.google.com/auth/clients"
            target="_blank"
            rel="noreferrer"
          >
            打开 Google Cloud 客户端设置 ↗
          </a>
          <input
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label="导入 Google 客户端 JSON"
            ref={fileInput}
            disabled={busy || !!flow}
            onChange={(event) => {
              void importClient(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button
            className="mail-import-client"
            disabled={busy || !!flow}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={15} />
            导入客户端 JSON
          </button>
          <p>
            配置和授权令牌加密保存在 Echo 后端。测试模式下 Google 授权可能在 7
            天后过期，届时重新连接即可。组织账号仍受管理员策略限制。
          </p>
        </details>
      )}
    </section>
  );
}
