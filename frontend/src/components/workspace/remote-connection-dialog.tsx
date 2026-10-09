import {
  CheckCircle2Icon,
  ChevronRightIcon,
  LoaderCircleIcon,
  XCircleIcon,
} from "lucide-react";
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
import { SegmentedControl } from "@/components/ui/segmented-control";
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

import { RemoteControlGuide } from "./remote-control-guide";

type ConnectionKind = RemoteTransport | "node";

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

/**
 * The one place to add somewhere else to run: an SSH host or a WSL distro
 * that runs Echo, or another machine that connects back (remote control).
 */
export function AddConnectionDialog({
  open,
  onOpenChange,
  distros = [],
  remote,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  distros?: WslDistro[];
  /** Whether SSH / WSL connections can be added here at all. */
  remote: { enabled: boolean; canManage: boolean };
  onAdded: (connection: {
    id: string;
    name: string;
    transport: RemoteTransport;
  }) => void;
}) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const [kind, setKind] = useState<ConnectionKind>("ssh_tunnel");
  const transport: RemoteTransport = kind === "wsl" ? "wsl" : "ssh_tunnel";
  const ssh = kind === "ssh_tunnel";
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [sshPort, setSshPort] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [distro, setDistro] = useState("");
  const [echoPort, setEchoPort] = useState(DEFAULT_PORT[transport]);
  const [token, setToken] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState<"idle" | "testing" | "saving">("idle");
  // Outcome of the last probe, tied to the exact settings it probed.
  const [probe, setProbe] = useState<{
    key: string;
    ok: boolean;
    text: string;
  } | null>(null);
  const [error, setError] = useState("");

  // Start blank each time the dialog opens; the distro list is refetched in
  // the background and must not wipe what the user is typing.
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    const fallback =
      distros.find((d) => d.default)?.name ?? distros[0]?.name ?? "";
    setKind("ssh_tunnel");
    setName("");
    setHost("");
    setSshPort("");
    setKeyPath("");
    setDistro(fallback);
    setEchoPort(DEFAULT_PORT.ssh_tunnel);
    setToken("");
    setAdvanced(false);
    setProbe(null);
    setError("");
  }, [open, distros]);

  const switchKind = (next: ConnectionKind) => {
    setKind(next);
    setProbe(null);
    setError("");
    if (next !== "node") setEchoPort(DEFAULT_PORT[next]);
  };

  const port = Number(echoPort || DEFAULT_PORT[transport]);
  const portValid = Number.isInteger(port) && port >= 1 && port <= 65535;
  const sshPortNumber = sshPort.trim() ? Number(sshPort) : 22;
  const sshPortValid =
    Number.isInteger(sshPortNumber) &&
    sshPortNumber >= 1 &&
    sshPortNumber <= 65535;
  const ready =
    portValid && (ssh ? Boolean(host.trim()) && sshPortValid : Boolean(distro));
  const defaultName = ssh ? splitSshTarget(host).host : distro;

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
  const draftKey = ready ? JSON.stringify(draft()) : "";
  const current = probe?.key === draftKey ? probe : null;

  const runProbe = async (): Promise<boolean> => {
    setBusy("testing");
    setError("");
    try {
      const outcome = await testRemoteConnection(draft());
      const ok = outcome.status === "ok";
      const text = ok
        ? zh
          ? "连接正常，远端 Echo 已响应"
          : "Connected — the remote Echo answered"
        : outcome.detail
          ? connectionErrorHint(outcome.detail, zh)
          : zh
            ? "连接失败"
            : "Connection failed";
      setProbe({ key: draftKey, ok, text });
      // Most fixes (port, key, token) live in the advanced section.
      if (!ok) setAdvanced(true);
      return ok;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      setBusy("idle");
    }
  };

  const save = async () => {
    setBusy("saving");
    setError("");
    try {
      const added = await addRemoteConnection({
        ...draft(),
        name: name.trim() || defaultName,
      });
      onAdded({ ...added, transport });
      onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy("idle");
    }
  };

  // "添加" checks the connection first; after a failed check the same
  // settings can still be saved on purpose ("仍要添加").
  const add = async () => {
    if (current && !current.ok) return save();
    if (current?.ok || (await runProbe())) await save();
  };

  const blocked =
    kind === "node"
      ? null
      : !remote.enabled
        ? zh
          ? "SSH / WSL 连接尚未开启：需要开启实验功能 ui.remote_transport。"
          : "SSH / WSL connections are off: enable the experimental ui.remote_transport flag."
        : !remote.canManage
          ? zh
            ? "只有管理员可以添加 SSH / WSL 连接。"
            : "Only admins can add SSH / WSL connections."
          : null;
  const description =
    kind === "node"
      ? zh
        ? "让另一台运行 Echo 的机器连过来，把任务派给它。"
        : "Let another machine running Echo connect here and take tasks."
      : ssh
        ? zh
          ? "在一台运行 Echo 的远程机器上执行对话。"
          : "Run conversations on a remote machine that runs Echo."
        : zh
          ? "在 WSL 里运行的 Echo 中执行对话（Linux 环境）。"
          : "Run conversations in Echo inside WSL (Linux).";
  const status = error
    ? { ok: false, text: error }
    : current
      ? { ok: current.ok, text: current.text }
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="remote-connection-dialog"
      >
        <DialogHeader className="text-left">
          <DialogTitle>{zh ? "添加连接" : "Add connection"}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <SegmentedControl<ConnectionKind>
          value={kind}
          onChange={switchKind}
          size="sm"
          fullWidth
          aria-label={zh ? "连接方式" : "Connection type"}
          options={[
            { value: "ssh_tunnel", label: "SSH" },
            ...(distros.length > 0
              ? [{ value: "wsl" as const, label: "WSL" }]
              : []),
            { value: "node", label: zh ? "远程控制" : "Remote control" },
          ]}
        />
        {kind === "node" ? (
          <RemoteControlGuide />
        ) : blocked ? (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            {blocked}
          </p>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (ready && busy === "idle") void add();
            }}
          >
            {ssh ? (
              <Field
                id="remote-host"
                label={zh ? "SSH 主机" : "SSH host"}
                hint={
                  zh
                    ? "也可以填 ~/.ssh/config 里的主机名。"
                    : "Or a host name from ~/.ssh/config."
                }
              >
                <Input
                  id="remote-host"
                  value={host}
                  autoFocus
                  placeholder="user@hostname"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setHost(event.target.value)}
                />
              </Field>
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
              id="remote-name"
              label={zh ? "名称（可选）" : "Name (optional)"}
            >
              <Input
                id="remote-name"
                value={name}
                placeholder={
                  defaultName ||
                  (ssh ? (zh ? "工作笔记本" : "Work laptop") : "Ubuntu")
                }
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <div className="grid gap-3">
              <button
                type="button"
                aria-expanded={advanced}
                onClick={() => setAdvanced((open) => !open)}
                className="flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronRightIcon
                  className={
                    "size-3.5 transition-transform" +
                    (advanced ? " rotate-90" : "")
                  }
                />
                {zh ? "高级选项" : "Advanced"}
              </button>
              {advanced ? (
                <div className="grid gap-3 rounded-lg border border-border/70 p-3">
                  <div
                    className={ssh ? "grid grid-cols-2 gap-3" : "grid gap-3"}
                  >
                    {ssh ? (
                      <Field
                        id="remote-ssh-port"
                        label={zh ? "SSH 端口" : "SSH port"}
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
                    ) : null}
                    <Field
                      id="remote-echo-port"
                      label={zh ? "Echo 端口" : "Echo port"}
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
                  </div>
                  <p className="-mt-1 text-xs leading-relaxed text-muted-foreground">
                    {ssh
                      ? zh
                        ? "Echo 端口是远端 Echo 后端的端口，它只需监听 127.0.0.1，流量走 SSH 隧道。"
                        : "The Echo port is the remote backend's port; it only needs to listen on 127.0.0.1."
                      : zh
                        ? "WSL 里 Echo 后端的端口，别和这台电脑上的 Echo 冲突。"
                        : "The Echo backend's port inside WSL; avoid this computer's own port."}
                  </p>
                  {ssh ? (
                    <Field
                      id="remote-key"
                      label={zh ? "SSH 密钥" : "SSH key"}
                      hint={
                        zh
                          ? "留空则用 SSH 配置或 ssh-agent；不支持密码登录。"
                          : "Leave empty to use your SSH config or agent; passwords are not supported."
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
                  ) : null}
                  <Field
                    id="remote-token"
                    label={zh ? "访问令牌" : "Access token"}
                    hint={
                      zh
                        ? "远端 Echo 开启登录时需要，加密保存在本机。"
                        : "Needed when the remote Echo requires sign-in; stored encrypted here."
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
                </div>
              ) : null}
            </div>
            {status ? (
              <p
                role="status"
                className={
                  "flex min-w-0 items-start gap-1.5 text-xs " +
                  (status.ok
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive")
                }
              >
                {status.ok ? (
                  <CheckCircle2Icon className="mt-px size-3.5 shrink-0" />
                ) : (
                  <XCircleIcon className="mt-px size-3.5 shrink-0" />
                )}
                <span className="break-all">{status.text}</span>
              </p>
            ) : null}
            {/* Enter in any field submits through the footer's 添加. */}
            <button type="submit" hidden />
          </form>
        )}
        <DialogFooter className="items-center sm:justify-between">
          {kind === "node" || blocked ? (
            <Button
              type="button"
              className="sm:ml-auto"
              onClick={() => onOpenChange(false)}
            >
              {zh ? "知道了" : "Got it"}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!ready || busy !== "idle"}
                onClick={() => void runProbe()}
              >
                {busy === "testing" ? (
                  <LoaderCircleIcon className="size-3.5 animate-spin" />
                ) : null}
                {zh ? "测试连接" : "Test connection"}
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  {zh ? "取消" : "Cancel"}
                </Button>
                <Button
                  type="button"
                  disabled={!ready || busy !== "idle"}
                  onClick={() => void add()}
                >
                  {busy === "saving" ? (
                    <LoaderCircleIcon className="size-3.5 animate-spin" />
                  ) : null}
                  {current && !current.ok
                    ? zh
                      ? "仍要添加"
                      : "Add anyway"
                    : zh
                      ? "添加"
                      : "Add"}
                </Button>
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
