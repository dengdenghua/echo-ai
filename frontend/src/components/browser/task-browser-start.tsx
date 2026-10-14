import { useState, type ReactNode } from "react";
import { ArrowRightIcon, Clock3Icon, GlobeIcon, SearchIcon } from "lucide-react";

export function resolveBrowserInput(value: string, searchUrl = "https://www.bing.com/search?q="): string {
  const input = value.trim();
  if (!input) return "";
  if (input === "about:blank" || /^https?:\/\//i.test(input)) return input;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i.test(input)) return `http://${input}`;
  if (!/\s/.test(input) && /^[^/:]+\.[^/:]+(?::\d+)?(?:\/.*)?$/.test(input)) return `https://${input}`;
  return searchUrl + encodeURIComponent(input);
}

export function TaskBrowserStart({ onNavigate, recentPages, children, renderHome }: {
  onNavigate: (value: string) => void;
  recentPages: Array<{url: string; title: string}>;
  children?: ReactNode;
  renderHome?: (onNavigate: (value: string) => void, children: ReactNode) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  if (renderHome) return renderHome(onNavigate, children);
  return (
    <section aria-label="浏览器新标签页" className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-6 py-12 sm:px-10">
      <div className="mb-6">
        <GlobeIcon className="mb-4 size-7 text-muted-foreground" strokeWidth={1.5} />
        <h2 className="text-xl font-medium tracking-tight">从这里开始浏览</h2>
        <p className="mt-2 text-sm text-muted-foreground">打开网页、搜索资料，或预览本地服务。</p>
      </div>
      <form role="search" onSubmit={event => { event.preventDefault(); if (query.trim()) onNavigate(query); }}
        className="flex h-12 items-center gap-3 rounded-xl border border-border-default bg-background px-4 shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/10">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <input aria-label="输入网址或搜索" placeholder="输入网址或搜索" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none" />
        <button type="submit" aria-label="打开" disabled={!query.trim()} className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"><ArrowRightIcon className="size-4" /></button>
      </form>
      {recentPages.length > 0 && <div className="mt-7">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">最近访问</h3>
        <div className="grid gap-1 sm:grid-cols-2">{recentPages.slice(0, 6).map(page => <button key={page.url} type="button" onClick={() => onNavigate(page.url)} title={page.url}
          className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-muted/50"><Clock3Icon className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{page.title || page.url}</span></button>)}</div>
      </div>}
      <div className="mt-7 border-t border-border-subtle pt-4">{children}</div>
    </section>
  );
}
