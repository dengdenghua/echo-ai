import {
  DownloadIcon,
  LayoutGridIcon,
  PuzzleIcon,
  SearchIcon,
  SmartphoneIcon,
  ZapIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { SquareCopy } from "@/core/i18n/locales/square";
import { cn } from "@/lib/utils";

import { fitsDesktop, formatCount, marketCategories } from "./square-data";
import { fetchSquareMarket } from "./square-host";
import {
  SquareEmpty,
  SquareLoading,
  SquareOffline,
  SquarePill,
} from "./square-states";
import type {
  SquareMarketItem,
  SquareMarketKindKey,
  SquareMarketSortKey,
} from "./square-types";

const KINDS: ReadonlyArray<{
  key: SquareMarketKindKey;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}> = [
  { key: "skill", icon: ZapIcon },
  { key: "plugin", icon: PuzzleIcon },
  { key: "app", icon: LayoutGridIcon },
];

/** Only the Square's app shelf can sort; the skill and plugin registry lists in one order. */
const APP_SORTS: readonly SquareMarketSortKey[] = [
  "downloads",
  "latest",
  "trending",
];

const HUB_TABS: Record<Exclude<SquareMarketKindKey, "app">, string> = {
  skill: "/workspace/agents?surface=chat&tab=skills",
  plugin: "/workspace/agents?surface=chat&tab=plugins",
};

type MarketState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; items: SquareMarketItem[] };

/**
 * 广场 · 市场: the phone's shelf of skills, plugins and apps, read from the
 * same catalogs. Installing happens where it always has: skills and plugins
 * in HUB, phone apps on the phone.
 */
export function SquareMarket({
  copy,
  locale,
  reloadKey,
}: {
  copy: SquareCopy;
  locale: string;
  reloadKey: number;
}) {
  const [kind, setKind] = useState<SquareMarketKindKey>("skill");
  const [sort, setSort] = useState<SquareMarketSortKey>("latest");
  const [category, setCategory] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<MarketState>({ status: "loading" });
  const [selected, setSelected] = useState<SquareMarketItem | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchSquareMarket(kind, kind === "app" ? sort : "latest", controller.signal)
      .then((market) => {
        if (controller.signal.aborted) return;
        const items =
          kind === "app" ? market.items : market.items.filter(fitsDesktop);
        setState({ status: "ready", items });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [kind, sort, attempt, reloadKey]);

  const items = useMemo(
    () => (state.status === "ready" ? state.items : []),
    [state],
  );
  const categories = useMemo(() => marketCategories(items), [items]);
  const needle = filter.trim().toLowerCase();
  const shown = items.filter(
    (item) =>
      (category === null || item.category === category) &&
      (!needle ||
        item.name.toLowerCase().includes(needle) ||
        item.description.toLowerCase().includes(needle)),
  );

  const switchKind = (next: SquareMarketKindKey) => {
    setKind(next);
    setSelected(null);
    setSort("latest");
    setCategory(null);
    setFilter("");
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label={copy.sections.market}
        className="flex flex-wrap items-center gap-1.5"
      >
        {KINDS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={kind === key}
            onClick={() => switchKind(key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm transition-colors duration-150",
              kind === key
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" strokeWidth={1.5} className="size-4" />
            {copy.market.kinds[key]}
          </button>
        ))}
        <label className="relative ml-auto w-full sm:w-56">
          <span className="sr-only">{copy.market.filterPlaceholder}</span>
          <SearchIcon
            aria-hidden="true"
            strokeWidth={1.5}
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={copy.market.filterPlaceholder}
            className="w-full rounded-sm border border-border-default bg-background py-1.5 pl-8 pr-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-core/60"
          />
        </label>
      </div>

      {kind === "app" && (
        <div className="flex flex-wrap items-center gap-3">
          {APP_SORTS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={sort === key}
              onClick={() => setSort(key)}
              className={cn(
                "text-xs transition-colors duration-150",
                sort === key
                  ? "font-medium text-foreground underline decoration-core decoration-2 underline-offset-4"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {copy.market.sorts[key]}
            </button>
          ))}
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground sm:ml-auto">
            <SmartphoneIcon
              aria-hidden="true"
              strokeWidth={1.5}
              className="size-3.5 shrink-0"
            />
            {copy.market.phoneAppsNote}
          </span>
        </div>
      )}

      {categories.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <SquarePill
            active={category === null}
            onClick={() => setCategory(null)}
          >
            {copy.market.all}
          </SquarePill>
          {categories.map((name) => (
            <SquarePill
              key={name}
              active={category === name}
              onClick={() => setCategory(name)}
            >
              {name}
            </SquarePill>
          ))}
        </div>
      )}

      {state.status === "loading" && <SquareLoading label={copy.loading} />}
      {state.status === "failed" && (
        <SquareOffline
          title={copy.market.loadFailed}
          description={copy.market.loadFailedDesc}
          retryLabel={copy.retry}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      )}
      {state.status === "ready" &&
        (shown.length === 0 ? (
          <SquareEmpty>{copy.market.empty}</SquareEmpty>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2">
            {shown.map((item) => (
              <li key={item.id}>
                <MarketCard
                  item={item}
                  kind={kind}
                  copy={copy}
                  locale={locale}
                  onOpen={setSelected}
                />
              </li>
            ))}
          </ul>
        ))}

      <MarketDetail
        item={selected}
        kind={kind}
        copy={copy}
        locale={locale}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function kindIcon(kind: SquareMarketKindKey) {
  return KINDS.find((entry) => entry.key === kind)?.icon ?? ZapIcon;
}

function MarketCard({
  item,
  kind,
  copy,
  locale,
  onOpen,
}: {
  item: SquareMarketItem;
  kind: SquareMarketKindKey;
  copy: SquareCopy;
  locale: string;
  onOpen: (item: SquareMarketItem) => void;
}) {
  const Icon = kindIcon(kind);
  const meta = [item.category].filter(Boolean);
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="flex h-full w-full items-start gap-3 rounded-md border border-border-subtle bg-card p-3 text-left transition-colors duration-150 hover:border-border-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-core/60"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-muted">
        <Icon
          aria-hidden="true"
          strokeWidth={1.5}
          className="size-4 text-foreground"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {item.name || item.slug}
        </span>
        {item.description && (
          <span className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {item.description}
          </span>
        )}
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {meta.map((part) => (
            <span key={part} className="truncate">
              {part}
            </span>
          ))}
          {item.downloads > 0 && (
            <span
              className="inline-flex items-center gap-1 font-mono tabular-nums"
              aria-label={copy.market.downloads(item.downloads)}
            >
              <DownloadIcon
                aria-hidden="true"
                strokeWidth={1.5}
                className="size-3"
              />
              {formatCount(item.downloads, locale)}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

function MarketDetail({
  item,
  kind,
  copy,
  locale,
  onClose,
}: {
  item: SquareMarketItem | null;
  kind: SquareMarketKindKey;
  copy: SquareCopy;
  locale: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const Icon = kindIcon(kind);
  const rows: Array<[string, string]> = item
    ? [
        [copy.market.details.type, copy.market.kinds[kind]],
        [copy.market.details.category, item.category],
        [copy.market.details.version, item.version],
        [copy.market.details.author, item.author],
        [
          copy.market.details.platforms,
          item.platforms
            .map((name) => copy.market.platformNames[name] ?? name)
            .join(" · "),
        ],
        [
          copy.market.details.downloads,
          item.downloads > 0 ? formatCount(item.downloads, locale) : "",
        ],
      ]
    : [];

  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        {item && (
          <div className="flex min-h-full flex-col">
            <SheetHeader className="flex-row items-center gap-3 border-b border-border-subtle px-5 py-4 pr-14">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-muted">
                <Icon aria-hidden="true" strokeWidth={1.5} className="size-4" />
              </span>
              <div className="min-w-0">
                <SheetTitle className="truncate text-sm">
                  {item.name || item.slug}
                </SheetTitle>
                <SheetDescription className="truncate font-mono text-xs">
                  {item.id}
                </SheetDescription>
              </div>
            </SheetHeader>
            <div className="space-y-4 overflow-y-auto px-5 py-4">
              {item.description && (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
                  {item.description}
                </p>
              )}
              <dl className="divide-y divide-border-subtle rounded-md border border-border-subtle">
                {rows
                  .filter(([, value]) => value)
                  .map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-4 px-3 py-2"
                    >
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="truncate text-xs text-foreground">
                        {value}
                      </dd>
                    </div>
                  ))}
              </dl>
              {kind === "app" ? (
                <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                  <SmartphoneIcon
                    aria-hidden="true"
                    strokeWidth={1.5}
                    className="mt-0.5 size-3.5 shrink-0"
                  />
                  {copy.market.phoneInstallNote}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    void navigate(HUB_TABS[kind]);
                  }}
                  className="w-full rounded-sm bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90"
                >
                  {copy.market.openInHub(copy.market.kinds[kind])}
                </button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
