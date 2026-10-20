import { EchoLockup } from "@/components/brand/echo-wordmark";
import { useI18n } from "@/core/i18n/hooks";
import { desktopStartupCopy } from "@/core/i18n/locales/desktop-startup";

/** An empty workspace frame while authentication starts; contains no user data. */
export function DesktopStartupShell() {
  const { locale } = useI18n();
  const copy = desktopStartupCopy(locale);
  return (
    <div
      className="flex min-h-[calc(100dvh-2rem)] bg-background text-foreground"
      data-testid="desktop-startup-shell"
    >
      <aside
        aria-hidden="true"
        className="hidden w-56 shrink-0 border-r border-border bg-muted/20 px-5 py-6 sm:block"
      >
        <EchoLockup wordmarkClassName="h-4" />
        <div className="mt-10 space-y-5">
          {["w-24", "w-20", "w-28", "w-16"].map((width) => (
            <div key={width} className={`h-2 rounded bg-foreground/5 ${width}`} />
          ))}
        </div>
        <div className="mt-14 h-px bg-border" />
        <div className="mt-6 space-y-4">
          {["w-32", "w-28", "w-36"].map((width) => (
            <div key={width} className={`h-2 rounded bg-foreground/5 ${width}`} />
          ))}
        </div>
      </aside>
      <main
        aria-busy="true"
        aria-label={copy.workspaceTitle}
        className="flex min-w-0 flex-1 flex-col"
      >
        <header className="flex h-14 items-center border-b border-border/50 px-6 text-xs text-muted-foreground">
          {copy.workspaceTitle}
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 pb-32">
          <EchoLockup wordmarkClassName="h-7" />
          <p className="text-sm text-muted-foreground">
            {copy.workspaceDetail}
          </p>
          <div
            aria-hidden="true"
            className="mt-5 h-28 w-full max-w-2xl rounded-2xl border border-border/60 bg-muted/10"
          />
        </div>
      </main>
    </div>
  );
}
