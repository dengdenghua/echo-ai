import { CheckCircle2Icon, LoaderCircleIcon, XCircleIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addRemoteConnection,
  splitSshTarget,
  testRemoteConnection,
  type RemoteConnectionDraft,
  type RemoteTransport,
  type WslDistro,
} from "@/core/execution/work-location";
import { useI18n } from "@/core/i18n/hooks";

const DEFAULT_PORT: Record<RemoteTransport, string> = {
  ssh_tunnel: "8310",
  wsl: "8320",
};

const SSH_HINTS: [RegExp, string, string][] = [
  [
    /Host key verification failed/i,
    "主机密钥未确认：先在终端里 ssh 连一次这台主机并接受指纹",
    "Unknown host key: ssh to this host once in a terminal and accept its fingerprint",
  ],
  [
    /Permission denied|publickey/i,
    "SSH 认证失败：检查密钥路径或 ssh-agent（不支持密码登录）",
    "SSH authentication failed: check the key or ssh-agent (passwords are not supported)",
  ],
  [
    /Could not resolve hostname|not known|nodename nor servname/i,
    "找不到这个主机名",
    "Host name not found",
  ],
  [
    /Connection refused/i,
    "连接被拒绝：那台机器没有运行 SSH 服务，或端口不对",
    "Connection refused: no SSH server on that port",
  ],
  [
    /timed out/i,
    "连接超时：检查网络或防火墙",
    "Timed out: check the network or firewall",
  ],
  [
    /forward|channel/i,
    "SSH 已连上，但远端端口上没有 Echo",
    "SSH works, but nothing listens on the Echo port",
  ],
  [
    /not available/i,
    "这台电脑没有 OpenSSH 客户端",
    "OpenSSH client is not installed",
  ],
];

const ECHO_HINTS: [RegExp, string, string][] = [
  [
    /HTTP 40[13]/,
    "远端 Echo 拒绝了访问：请填写访问令牌",
    "The remote Echo refused access: add an access token",
  ],
  [
    /Connect|refused|timed out/i,
    "连不上 Echo：确认它已经启动，端口填对了",
    "Echo is unreachable: make sure it is running on that port",
  ],
];

/** Turn OpenSSH / probe errors into a next step, keeping the raw detail. */
export function connectionErrorHint(detail: string, zh: boolean): string {
  const ssh = detail.startsWith("ssh_tunnel_failed:");
  const raw = detail.replace(/^ssh_tunnel_failed:\s*/, "").trim();
  const hit = (ssh ? SSH_HINTS : ECHO_HINTS).find(([pattern]) =>
    pattern.test(raw),
  );
  if (!hit) return raw;
  return `${zh ? hit[1] : hit[2]}${zh ? "（" : " ("}${raw}${zh ? "）" : ")"}`;
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      {children}
      {hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Add an SSH host or a WSL distro that runs Echo, mirroring "Add SSH connection". */
export function RemoteConnectionDialog({
  open,
  onOpenChange,
  transport,
  distros = [],
  initialDistro,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transport: RemoteTransport;
  distros?: WslDistro[];
  initialDistro?: string;
  onAdded: (connection: {
    id: string;
    name: string;
    transport: RemoteTransport;
  }) => void;
}) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const ssh = transport === "ssh_tunnel";
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [sshPort, setSshPort] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [distro, setDistro] = useState("");
  const [echoPort, setEchoPort] = useState(DEFAULT_PORT[transport]);
  const [token, setToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  // Start blank each time the dialog opens; the distro list is refetched in
  // the background and must not wipe what the user is typing.
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    const fallback =
      distros.find((d) => d.default)?.name ?? distros[0]?.name ?? "";
    setName(ssh ? "" : (initialDistro ?? fallback));
    setHost("");
    setSshPort("");
    setKeyPath("");
    setDistro(initialDistro ?? fallback);
    setEchoPort(DEFAULT_PORT[transport]);
    setToken("");
    setResult(null);
  }, [open, ssh, transport, distros, initialDistro]);

  const port = Number(echoPort || DEFAULT_PORT[transport]);
  const portValid = Number.isInteger(port) && port >= 1 && port <= 65535;
  const sshPortNumber = sshPort.trim() ? Number(sshPort) : 22;
  const ready =
    portValid &&
    (ssh
      ? Boolean(host.trim()) &&
        Number.isInteger(sshPortNumber) &&
        sshPortNumber >= 1 &&
        sshPortNumber <= 65535
      : Boolean(distro));

  const draft = (): Omit<RemoteConnectionDraft, "name"> => {
    const base = {
      url: `http://127.0.0.1:${port}`,
      auth_token: token.trim() || undefined,
    };
    if (!ssh) return { ...base, wsl: { distro } };
    const { host: sshHost, user } = splitSshTarget(host);
    return {
      ...base,
      ssh: {
        host: sshHost,
        user,
        port: sshPortNumber,
        identity_file: keyPath.trim() || null,
      },
    };
  };

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const outcome = await testRemoteConnection(draft());
      setResult(
        outcome.status === "ok"
          ? {
              ok: true,
              text: zh
                ? "连接正常，远端 Echo 已响应"
                : "Connected — the remote Echo answered",
            }
          : {
              ok: false,
              text: outcome.detail
                ? connectionErrorHint(outcome.detail, zh)
                : zh
                  ? "连接失败"
                  : "Connection failed",
            },
      );
    } catch (error) {
      setResult({
        ok: false,
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setResult(null);
    try {
      const fallbackName = ssh ? splitSshTarget(host).host : distro;
      const added = await addRemoteConnection({
        ...draft(),
        name: name.trim() || fallbackName,
      });
      onAdded({ ...added, transport });
      onOpenChange(false);
    } catch (error) {
      setResult({
        ok: false,
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const title = ssh
    ? zh
      ? "添加 SSH 连接"
      : "Add SSH connection"
    : zh
      ? "添加 WSL 连接"
      : "Add WSL connection";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="remote-connection-dialog"
      >
        <DialogHeader className="text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {ssh
              ? zh
                ? "连接到一台运行着 Echo 的远程机器，对话会在那台机器上执行。"
                : "Connect to a remote machine running Echo; turns run on that machine."
              : zh
                ? "连接到在 WSL 发行版里运行的 Echo，对话会在 Linux 环境中执行。"
                : "Connect to Echo running inside a WSL distro; turns run in Linux."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <Field
            id="remote-name"
            label={zh ? "名称" : "Name"}
            hint={
              zh
                ? "给这个连接起个好认的名字。"
                : "A friendly name for this connection."
            }
          >
            <Input
              id="remote-name"
              value={name}
              autoFocus
              placeholder={ssh ? (zh ? "工作笔记本" : "Work laptop") : "Ubuntu"}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {ssh ? (
            <>
              <Field
                id="remote-host"
                label={zh ? "SSH 主机" : "SSH host"}
                hint={
                  zh
                    ? "user@myserver.com，或 ~/.ssh/config 里的主机名。"
                    : "user@myserver.com or a host from ~/.ssh/config."
                }
              >
                <Input
                  id="remote-host"
                  value={host}
                  placeholder="user@hostname"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setHost(event.target.value)}
                />
              </Field>
              <Field
                id="remote-ssh-port"
                label={zh ? "SSH 端口" : "SSH port"}
                hint={
                  zh
                    ? "留空则用 22 或你的 SSH 配置。"
                    : "Leave empty to use 22 or your SSH configuration."
                }
              >
                <Input
                  id="remote-ssh-port"
                  value={sshPort}
                  inputMode="numeric"
                  placeholder="22"
                  onChange={(event) =>
                    setSshPort(event.target.value.replace(/\D/g, ""))
                  }
                />
              </Field>
              <Field
                id="remote-key"
                label={zh ? "SSH 密钥（可选）" : "SSH key (optional)"}
                hint={
                  zh
                    ? "私钥路径。留空则使用 SSH 配置或 ssh-agent；不支持密码登录。"
                    : "Path to a private key. Leave empty to use your SSH config or agent; passwords are not supported."
                }
              >
                <Input
                  id="remote-key"
                  value={keyPath}
                  placeholder="~/.ssh/id_ed25519"
                  spellCheck={false}
                  onChange={(event) => setKeyPath(event.target.value)}
                />
              </Field>
            </>
          ) : (
            <Field id="remote-distro" label={zh ? "发行版" : "Distro"}>
              <Select value={distro} onValueChange={setDistro}>
                <SelectTrigger id="remote-distro">
                  <SelectValue
                    placeholder={zh ? "选择发行版" : "Choose a distro"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {distros.map((item) => (
                    <SelectItem key={item.name} value={item.name}>
                      {item.name}
                      {item.version === 1 ? " (WSL 1)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field
            id="remote-echo-port"
            label={zh ? "Echo 端口" : "Echo port"}
            hint={
              ssh
                ? zh
                  ? "远端机器上 Echo 后端的端口。只需监听 127.0.0.1，流量走 SSH 加密隧道。"
                  : "Port of the Echo backend on that machine. It only needs to listen on 127.0.0.1; traffic goes through SSH."
                : zh
                  ? "WSL 里 Echo 后端的端口，避免与本机 Echo 冲突。WSL 2 会把它转发到本机 127.0.0.1。"
                  : "Port of the Echo backend inside WSL; avoid this computer's own port. WSL 2 forwards it to 127.0.0.1."
            }
          >
            <Input
              id="remote-echo-port"
              value={echoPort}
              inputMode="numeric"
              placeholder={DEFAULT_PORT[transport]}
              onChange={(event) =>
                setEchoPort(event.target.value.replace(/\D/g, ""))
              }
            />
          </Field>
          <Field
            id="remote-token"
            label={zh ? "访问令牌（可选）" : "Access token (optional)"}
            hint={
              zh
                ? "远端 Echo 开启了登录时填写，会加密保存在本机。"
                : "Needed when the remote Echo requires sign-in. Stored encrypted on this computer."
            }
          >
            <Input
              id="remote-token"
              type="password"
              value={token}
              autoComplete="off"
              onChange={(event) => setToken(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!ready || testing}
              onClick={runTest}
            >
              {testing ? (
                <LoaderCircleIcon className="size-3.5 animate-spin" />
              ) : null}
              {zh ? "测试连接" : "Test connection"}
            </Button>
            {result ? (
              <span
                role="status"
                className={
                  "flex min-w-0 items-start gap-1.5 text-xs " +
                  (result.ok
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive")
                }
              >
                {result.ok ? (
                  <CheckCircle2Icon className="mt-px size-3.5 shrink-0" />
                ) : (
                  <XCircleIcon className="mt-px size-3.5 shrink-0" />
                )}
                <span className="break-all">{result.text}</span>
              </span>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {zh ? "取消" : "Cancel"}
          </Button>
          <Button type="button" disabled={!ready || saving} onClick={save}>
            {saving ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : null}
            {title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
