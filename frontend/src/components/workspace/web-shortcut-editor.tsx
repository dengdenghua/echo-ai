import { useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GlobeIcon,
  PencilIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  moveWorkspaceWebShortcut,
  setWorkspaceWebShortcut,
  useWorkspaceWebShortcuts,
} from "@/core/workbench/apps";

export function WebShortcutEditor() {
  const shortcuts = useWorkspaceWebShortcuts();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const reset = () => {
    setName("");
    setUrl("");
    setEditing(null);
    setError("");
  };
  return (
    <section className="mb-5 border-b border-border-subtle pb-5">
      <h3 className="mb-1 text-sm font-medium">网页标签</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        固定到左侧，在 Echo 内打开。保存在当前浏览器或设备。
      </p>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const raw = url.trim();
            if (!raw) throw new Error();
            const parsed = new URL(
              /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`,
            );
            if (
              !["https:", "http:"].includes(parsed.protocol) ||
              parsed.username ||
              parsed.password
            )
              throw new Error();
            const normalized = parsed.href;
            if (
              shortcuts.some(
                (item) => item.url === normalized && item.id !== editing,
              )
            ) {
              setError("这个网址已经在侧栏中。");
              return;
            }
            const previous = shortcuts.find((item) => item.id === editing);
            if (previous && previous.url !== normalized)
              setWorkspaceWebShortcut(previous, false);
            setWorkspaceWebShortcut(
              { name: name.trim() || parsed.hostname, url: normalized },
              true,
            );
            reset();
          } catch {
            setError("请输入有效的 http 或 https 网址，不要包含账号密码。");
          }
        }}
      >
        <div className="flex gap-2">
          <Input
            aria-label="网页名称"
            placeholder="名称（可选）"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-1/3"
          />
          <Input
            aria-label="网页网址"
            placeholder="https://example.com"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="min-w-0 flex-1"
          />
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            {editing ? "保存网页" : "添加网页"}
          </Button>
          {editing && (
            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              取消编辑
            </Button>
          )}
        </div>
      </form>
      <ul className="mt-3 space-y-1">
        {shortcuts.map((item, index) => (
          <li
            key={item.id}
            className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1"
          >
            <GlobeIcon className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{item.name}</div>
              <div
                className="truncate text-xs text-muted-foreground"
                title={item.url}
              >
                {item.url}
              </div>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`上移 ${item.name}`}
              disabled={index === 0}
              onClick={() => moveWorkspaceWebShortcut(item.id, -1)}
            >
              <ArrowUpIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`下移 ${item.name}`}
              disabled={index === shortcuts.length - 1}
              onClick={() => moveWorkspaceWebShortcut(item.id, 1)}
            >
              <ArrowDownIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`编辑 ${item.name}`}
              onClick={() => {
                setEditing(item.id);
                setName(item.name);
                setUrl(item.url);
                setError("");
              }}
            >
              <PencilIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`移除 ${item.name}`}
              onClick={() => {
                setWorkspaceWebShortcut(item, false);
                if (editing === item.id) reset();
              }}
            >
              <XIcon className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
