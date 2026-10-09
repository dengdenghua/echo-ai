import { KeyRoundIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export const PASSWORDS_CHANGED_EVENT = "echo:browser-passwords-changed";

type PasswordOffer = {
  token: string;
  origin: string;
  username: string;
  update: boolean;
};

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/**
 * "Save password?" after a login in a browser tab (desktop app). The
 * password itself stays in the desktop shell; this only answers.
 */
export function PasswordOfferBubble() {
  const [offer, setOffer] = useState<PasswordOffer | null>(null);

  useEffect(() => {
    if (!window.echo?.on) return;
    return window.echo.on("browser:password-offer", (...args) => {
      const next = args[0] as PasswordOffer | undefined;
      if (next?.token) setOffer(next);
    });
  }, []);

  const answer = async (save: boolean | "never") => {
    const current = offer;
    setOffer(null);
    if (!current || !window.echo?.browser?.resolvePasswordOffer) return;
    const result = await window.echo.browser.resolvePasswordOffer(
      current.token,
      save,
    );
    if (save === "never") {
      window.dispatchEvent(new Event(PASSWORDS_CHANGED_EVENT));
      return;
    }
    if (!save) return;
    if (result.ok && result.saved) {
      window.dispatchEvent(new Event(PASSWORDS_CHANGED_EVENT));
      toast.success(current.update ? "密码已更新" : "密码已安全保存");
    } else {
      toast.error(result.error || "保存密码失败");
    }
  };

  if (!offer) return null;
  return (
    <div
      role="dialog"
      aria-label={offer.update ? "更新密码" : "保存密码"}
      className="absolute right-2 top-full z-50 mt-2 w-72 rounded-xl border border-border-subtle bg-popover p-3 text-popover-foreground shadow-lg"
    >
      <div className="flex items-start gap-2">
        <KeyRoundIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {offer.update ? "更新" : "保存"} {hostOf(offer.origin)} 的密码？
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {offer.username}
          </p>
        </div>
        <button
          type="button"
          aria-label="关闭"
          onClick={() => void answer(false)}
          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
        密码由系统加密保存，只留在这台电脑上。
      </p>
      <div className="mt-3 flex items-center gap-2">
        {offer.update ? null : (
          <button
            type="button"
            onClick={() => void answer("never")}
            className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            此网站永不
          </button>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void answer(false)}
          className="h-7 rounded-md px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          不保存
        </button>
        <button
          type="button"
          onClick={() => void answer(true)}
          className="h-7 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          {offer.update ? "更新" : "保存"}
        </button>
      </div>
    </div>
  );
}

type SavedLogin = { id: string; username: string };

/**
 * Key button in the address bar for a site with saved logins: one click
 * fills the only login, otherwise pick one. Never fills on its own.
 */
export function SavedPasswordButton({
  origin,
  webContentsId,
}: {
  origin: string | null;
  webContentsId: number | null;
}) {
  const [logins, setLogins] = useState<SavedLogin[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const api = window.echo?.browser;
    if (!origin || !api?.listPasswords) {
      setLogins([]);
      return;
    }
    const result = await api.listPasswords(origin);
    setLogins(
      result.ok
        ? result.entries.map(({ id, username }) => ({ id, username }))
        : [],
    );
  }, [origin]);

  useEffect(() => {
    setOpen(false);
    void refresh();
    window.addEventListener(PASSWORDS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PASSWORDS_CHANGED_EVENT, refresh);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const fill = async (id: string) => {
    setOpen(false);
    if (webContentsId == null || !window.echo?.browser?.fillPassword) return;
    const result = await window.echo.browser.fillPassword(webContentsId, id);
    if (result?.ok) toast.success("已填充登录信息");
    else toast.error(result?.error || "这个页面没有可填充的登录表单");
  };

  if (logins.length === 0) return null;
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title="填充已保存的密码"
        aria-label="填充已保存的密码"
        aria-haspopup={logins.length > 1 ? "menu" : undefined}
        onClick={() =>
          logins.length === 1 ? void fill(logins[0]!.id) : setOpen((v) => !v)
        }
        className="grid size-7 place-items-center rounded-full text-primary transition-colors hover:bg-primary/10"
      >
        <KeyRoundIcon className="size-3.5" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="选择要填充的账号"
          className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-border-subtle bg-popover p-1 text-xs text-popover-foreground shadow-lg"
        >
          {logins.map((login) => (
            <button
              key={login.id}
              type="button"
              role="menuitem"
              onClick={() => void fill(login.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
            >
              <KeyRoundIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{login.username}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
