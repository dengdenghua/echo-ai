import type { Bookmark } from "./browser-store";

/** One-click bookmarks under the address bar (toggle with Ctrl+Shift+B). */
export function BookmarksBar({
  bookmarks,
  onOpen,
}: {
  bookmarks: Bookmark[];
  onOpen: (url: string) => void;
}) {
  if (bookmarks.length === 0) return null;
  return (
    <nav
      aria-label="书签栏"
      className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-subtle px-2 [scrollbar-width:none]"
    >
      {bookmarks.map((bookmark) => {
        let host = bookmark.url;
        try {
          host = new URL(bookmark.url).hostname.replace(/^www\./, "");
        } catch {
          /* keep the raw url */
        }
        const label = bookmark.title?.trim() || host;
        return (
          <button
            key={bookmark.url}
            type="button"
            title={`${label}\n${bookmark.url}`}
            onClick={() => onOpen(bookmark.url)}
            className="flex h-6 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            {bookmark.favicon ? (
              <img
                src={bookmark.favicon}
                alt=""
                className="size-3.5 shrink-0 rounded-sm"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <span className="grid size-3.5 shrink-0 place-items-center rounded-sm bg-muted text-[9px] font-semibold uppercase">
                {host.charAt(0)}
              </span>
            )}
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
