import {
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  CloudSun,
  Compass,
  Globe,
  Grip,
  Newspaper,
  PlaneTakeoff,
  Scale,
  Search,
  Settings,
  Sparkles,
  UserRound,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/providers/AuthProvider";
import { cn } from "@/lib/utils";
import { StaticEchoCosmos } from "./StaticEchoCosmos";
import { resolveBrowserInput } from "./task-browser-start";
import { describeWeather, useWeather } from "./weather";
import "./browser-start-page.css";

const CUSTOM_WALLPAPER_KEY = "echo.browser.start.custom-wallpaper.v1";
const WALLPAPER_KEY_V2 = "echo.browser.start.wallpaper.v2";
const WALLPAPER_KEY_LEGACY = "echo.browser.start.wallpaper.v1";

export interface WallpaperOption {
  id: string;
  name: string;
  url?: string;
  isCosmos?: boolean;
}

const WALLPAPERS: readonly WallpaperOption[] = [
  {
    id: "echo-cosmos",
    name: "回响星域 (官方)",
    isCosmos: true,
  },
  {
    id: "ocean",
    name: "星海",
    url: "/images/browser-wallpapers/milky-way-ocean.png",
  },
  {
    id: "forest",
    name: "森林",
    url: "/images/browser-wallpapers/forest-calm.png",
  },
  { id: "sky", name: "晴空", url: "/images/browser-wallpapers/sky-studio.png" },
] as const;

export interface StartSite {
  url: string;
  title: string;
  favicon?: string;
}

/** The most visited web sites in browsing history, one tile per host. */
export function topSitesFromHistory(
  history: readonly { url: string; favicon?: string; visitedAt: number }[],
  limit = 8,
): StartSite[] {
  const byHost = new Map<string, StartSite & { count: number; last: number }>();
  for (const entry of history) {
    if (!/^https?:\/\//i.test(entry.url)) continue;
    let origin: URL;
    try {
      origin = new URL(entry.url);
    } catch {
      continue;
    }
    const host = origin.hostname.replace(/^www\./, "");
    const seen = byHost.get(host);
    if (seen) {
      seen.count += 1;
      seen.last = Math.max(seen.last, entry.visitedAt);
      seen.favicon ||= entry.favicon;
    } else {
      byHost.set(host, {
        url: `${origin.origin}/`,
        title: host,
        favicon: entry.favicon,
        count: 1,
        last: entry.visitedAt,
      });
    }
  }
  return [...byHost.values()]
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, limit)
    .map(({ url, title, favicon }) => ({ url, title, favicon }));
}

const PROMPTS: readonly { icon: LucideIcon; text: string }[] = [
  { icon: Newspaper, text: "今天有哪些值得看的科技新闻？" },
  { icon: Scale, text: "帮我对比 iPhone 16 和 Pixel 9 的拍照与续航" },
  { icon: Compass, text: "打开 GitHub，找本周最热门的 AI 开源项目" },
  { icon: PlaneTakeoff, text: "帮我规划一个周末两天的杭州行程" },
];

type StartOption = {
  kind: "open" | "ask" | "search";
  icon: LucideIcon;
  label: string;
  hint: string;
  run: () => void;
};

interface StartApp {
  name: string;
  url: string;
  icon: LucideIcon;
  description: string;
  category: string;
}
interface Props {
  children?: ReactNode;
  active: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  engines: { name: string }[];
  selectedEngine: number;
  onEngineChange: (index: number) => void;
  apps: StartApp[];
  onOpen: (url: string) => void;
  onManageDesktop: () => void;
  /**
   * Ask the browser AI. When given, the box becomes "问 AI，或搜索、输入网址":
   * Enter asks AI unless the text is an address, and search stays one
   * arrow-key away.
   */
  onAsk?: (text: string) => void;
  /** Most visited sites, shown under the box on an empty start page. */
  topSites?: StartSite[];
}

export function BrowserStartPage({
  active,
  children,
  query,
  onQueryChange,
  onSearch,
  searchInputRef,
  engines,
  selectedEngine,
  onEngineChange,
  apps,
  onOpen,
  onManageDesktop,
  onAsk,
  topSites = [],
}: Props) {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [panel, setPanel] = useState<
    "apps" | "settings" | "account" | "weather" | null
  >(null);
  const [appQuery, setAppQuery] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const {
    city,
    setCity,
    weather,
    loading: weatherLoading,
    error: weatherError,
  } = useWeather();
  const [cityDraft, setCityDraft] = useState("");
  const weatherLook = weather
    ? describeWeather(weather.code, true, weather.isDay)
    : null;
  const [activeOption, setActiveOption] = useState(0);
  const [wallpaper, setWallpaper] = useState(() => {
    try {
      const v2 = localStorage.getItem(WALLPAPER_KEY_V2);
      if (v2) return v2;
      const custom = localStorage.getItem(CUSTOM_WALLPAPER_KEY);
      const v1 = localStorage.getItem(WALLPAPER_KEY_LEGACY);
      if (v1 === "custom" && custom) return "custom";
      return "echo-cosmos";
    } catch {
      return "echo-cosmos";
    }
  });
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [customWallpaper, setCustomWallpaper] = useState(() => {
    try {
      return localStorage.getItem(CUSTOM_WALLPAPER_KEY) || "";
    } catch {
      return "";
    }
  });
  const uploadWallpaper = (file?: File) => {
    if (!file) return;
    setUploadError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setUploadError("请选择 JPG、PNG 或 WebP 图片。");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError("图片不能超过 2 MB，请压缩后重试。");
      return;
    }
    setUploading(true);
    const reader = new FileReader();
    reader.onerror = () => {
      setUploading(false);
      setUploadError("图片读取失败，请重试。");
    };
    reader.onload = () => {
      const url = String(reader.result);
      const img = new Image();
      img.onerror = () => {
        setUploading(false);
        setUploadError("无法打开这张图片，请换一张。");
      };
      img.onload = () => {
        try {
          localStorage.setItem(CUSTOM_WALLPAPER_KEY, url);
          localStorage.setItem(WALLPAPER_KEY_V2, "custom");
          setCustomWallpaper(url);
          setWallpaper("custom");
        } catch {
          setUploadError("本地存储空间不足，请选择更小的图片。");
        }
        setUploading(false);
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
  };
  const wallpaperOptions: WallpaperOption[] = customWallpaper
    ? [...WALLPAPERS, { id: "custom", name: "自定义", url: customWallpaper }]
    : [...WALLPAPERS];
  const image: WallpaperOption =
    wallpaperOptions.find((item) => item.id === wallpaper) ?? WALLPAPERS[0]!;
  const visibleApps = apps.filter((app) =>
    `${app.name} ${app.description}`
      .toLowerCase()
      .includes(appQuery.trim().toLowerCase()),
  );
  const chooseWallpaper = (id: string) => {
    setWallpaper(id);
    try {
      localStorage.setItem(WALLPAPER_KEY_V2, id);
    } catch {
      /* Session preference still works. */
    }
  };
  const manageDesktop = () => {
    setPanel(null);
    onManageDesktop();
  };
  const aiMode = Boolean(onAsk);
  const trimmed = query.trim();
  const engineName = engines[selectedEngine]?.name ?? "搜索引擎";
  const directUrl = (() => {
    if (!trimmed) return "";
    const resolved = resolveBrowserInput(trimmed, "search:");
    return resolved.startsWith("search:") ? "" : resolved;
  })();
  const options: StartOption[] =
    aiMode && trimmed
      ? [
          ...(directUrl
            ? [
                {
                  kind: "open" as const,
                  icon: Globe,
                  label: directUrl,
                  hint: "打开网址",
                  run: () => onOpen(directUrl),
                },
              ]
            : []),
          {
            kind: "ask",
            icon: Sparkles,
            label: trimmed,
            hint: "问 AI",
            run: () => {
              onAsk?.(trimmed);
              onQueryChange("");
            },
          },
          {
            kind: "search",
            icon: Search,
            label: trimmed,
            hint: `用 ${engineName} 搜索`,
            run: onSearch,
          },
        ]
      : [];
  const current = Math.min(activeOption, Math.max(options.length - 1, 0));
  const submit = () => {
    if (options.length > 0) {
      setSuggestOpen(false);
      options[current]!.run();
    } else if (!aiMode) {
      onSearch();
    }
  };
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!aiMode || options.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSuggestOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveOption((current + step + options.length) % options.length);
    } else if (event.key === "Escape") {
      setSuggestOpen(false);
    }
  };
  const showPrompts = aiMode && !children && !trimmed;
  const showSites = !children && !trimmed && topSites.length > 0;
  return (
    <section
      aria-label="浏览器主页"
      className="browser-start-page"
      style={{ display: active ? undefined : "none" }}
    >
      {image.isCosmos ? (
        <StaticEchoCosmos />
      ) : image.url ? (
        <img
          className="browser-start-wallpaper"
          src={image.url}
          alt=""
          fetchPriority="high"
          decoding="async"
          draggable={false}
        />
      ) : (
        <StaticEchoCosmos />
      )}
      <header className="browser-start-header">
        <button
          type="button"
          className="browser-start-icon"
          aria-label="应用"
          title="应用"
          aria-haspopup="dialog"
          onClick={() => setPanel("apps")}
        >
          <Grip size={20} strokeWidth={1.75} />
        </button>
        <div className="browser-start-actions">
          <button
            type="button"
            className="browser-start-weather"
            title={
              weather && weatherLook
                ? `${weather.city} · ${weatherLook.text}`
                : "设置天气城市"
            }
            aria-haspopup="dialog"
            onClick={() => {
              setCityDraft(city);
              setPanel("weather");
            }}
          >
            {weather && weatherLook ? (
              <>
                <span aria-hidden="true">{weatherLook.emoji}</span>
                <span>
                  {Math.round(weather.temperature)}° {weather.city}
                </span>
              </>
            ) : (
              <>
                <CloudSun size={20} strokeWidth={1.75} />
                <span>天气</span>
              </>
            )}
          </button>
          <button
            type="button"
            className="browser-start-icon"
            aria-label="主页设置"
            title="主页设置"
            aria-haspopup="dialog"
            onClick={() => setPanel("settings")}
          >
            <Settings size={20} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="browser-start-account"
            aria-label={isAuthenticated ? "账号" : "登录"}
            title={isAuthenticated ? "账号" : "登录"}
            onClick={() =>
              isAuthenticated
                ? setPanel("account")
                : navigate("/login?returnTo=%2Fbrowser")
            }
          >
            {isAuthenticated ? (
              <UserRound size={20} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              "登录"
            )}
          </button>
        </div>
      </header>
      <div className="browser-start-main">
        <form
          className="browser-start-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {aiMode ? (
            <Sparkles
              className="browser-start-search-mark"
              size={18}
              strokeWidth={1.8}
              aria-hidden="true"
            />
          ) : null}
          <input
            ref={searchInputRef}
            aria-label={aiMode ? "问 AI，或搜索、输入网址" : "搜索网页"}
            role={aiMode ? "combobox" : undefined}
            aria-expanded={
              aiMode ? suggestOpen && options.length > 0 : undefined
            }
            aria-controls={aiMode ? "browser-start-suggest" : undefined}
            aria-activedescendant={
              aiMode && suggestOpen && options.length > 0
                ? `browser-start-option-${current}`
                : undefined
            }
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
              setActiveOption(0);
              setSuggestOpen(true);
            }}
            onKeyDown={onSearchKey}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => setSuggestOpen(false)}
            placeholder={aiMode ? "问 AI，或搜索、输入网址" : "搜索网页"}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint={aiMode ? "go" : "search"}
          />
          <button
            type="submit"
            aria-label={aiMode ? "发送" : "搜索"}
            title={
              aiMode
                ? (options[current]?.hint ?? "问 AI")
                : `使用 ${engineName} 搜索`
            }
          >
            {aiMode && options[current]?.kind !== "search" ? (
              <Sparkles size={20} strokeWidth={1.8} />
            ) : (
              <Search size={22} strokeWidth={1.8} />
            )}
          </button>
          {aiMode && suggestOpen && options.length > 0 ? (
            <ul
              id="browser-start-suggest"
              role="listbox"
              className="browser-start-suggest"
            >
              {options.map((option, index) => (
                <li
                  key={option.kind}
                  id={`browser-start-option-${index}`}
                  role="option"
                  aria-selected={index === current}
                  className="browser-start-suggest-row"
                  data-active={index === current ? "true" : undefined}
                  // Keep focus in the box; act on mouse down before blur.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setSuggestOpen(false);
                    option.run();
                  }}
                  onMouseEnter={() => setActiveOption(index)}
                >
                  <option.icon size={16} strokeWidth={1.8} aria-hidden="true" />
                  <span className="browser-start-suggest-label">
                    {option.label}
                  </span>
                  <span className="browser-start-suggest-hint">
                    {option.hint}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </form>
        {showPrompts ? (
          <div className="browser-start-prompts" aria-label="试试这样问">
            {PROMPTS.map((prompt) => (
              <button
                key={prompt.text}
                type="button"
                className="browser-start-prompt"
                onClick={() => {
                  onQueryChange(prompt.text);
                  setActiveOption(0);
                  searchInputRef.current?.focus();
                }}
              >
                <prompt.icon size={14} strokeWidth={1.8} aria-hidden="true" />
                <span>{prompt.text}</span>
              </button>
            ))}
          </div>
        ) : null}
        {showSites ? (
          <nav className="browser-start-sites" aria-label="常去网站">
            {topSites.map((site) => (
              <button
                key={site.url}
                type="button"
                className="browser-start-site"
                title={site.url}
                onClick={() => onOpen(site.url)}
              >
                <span className="browser-start-site-icon" aria-hidden="true">
                  {site.favicon ? (
                    <img
                      src={site.favicon}
                      alt=""
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  ) : null}
                  <span>{site.title.charAt(0).toUpperCase()}</span>
                </span>
                <span className="browser-start-site-name">{site.title}</span>
              </button>
            ))}
          </nav>
        ) : null}
      </div>
      {children && (
        <div className="browser-start-task-services bg-background text-foreground">
          {children}
        </div>
      )}
      <Dialog
        open={active && panel !== null}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
      >
        <DialogContent
          className={cn(
            "browser-start-panel flex flex-col overflow-hidden",
            panel === "apps" && "browser-start-app-panel",
          )}
        >
          <DialogHeader className="shrink-0 pr-8 text-left">
            <DialogTitle>
              {panel === "apps"
                ? "应用"
                : panel === "account"
                  ? "账号"
                  : panel === "weather"
                    ? "天气"
                    : "主页设置"}
            </DialogTitle>
            <DialogDescription>
              {panel === "apps"
                ? "打开常用网站与 Echo 工作台"
                : panel === "account"
                  ? "当前 Echo 登录账号"
                  : panel === "weather"
                    ? "数据来自 Open-Meteo，只会发送你填的城市名"
                    : "设置主页背景、搜索引擎与应用"}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            {panel === "apps" ? (
              <>
                <input
                  className="browser-start-app-search"
                  aria-label="搜索应用"
                  placeholder="搜索应用…"
                  value={appQuery}
                  onChange={(event) => setAppQuery(event.target.value)}
                />
                <div className="browser-start-apps">
                  {visibleApps.map((app) => (
                    <button
                      type="button"
                      key={app.url}
                      title={app.description}
                      onClick={() => {
                        setPanel(null);
                        onOpen(app.url);
                      }}
                    >
                      <span>
                        <app.icon size={23} strokeWidth={1.6} />
                      </span>
                      <span>{app.name}</span>
                    </button>
                  ))}
                </div>
                {!visibleApps.length && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    没有找到相关应用
                  </p>
                )}
                <button
                  type="button"
                  className="browser-start-setting-row"
                  onClick={manageDesktop}
                >
                  管理应用与小组件
                  <ArrowUpRight size={16} />
                </button>
              </>
            ) : panel === "weather" ? (
              <div className="grid gap-4">
                {weather && weatherLook ? (
                  <div className="flex items-center gap-3">
                    <span className="text-3xl" aria-hidden="true">
                      {weatherLook.emoji}
                    </span>
                    <div>
                      <p className="text-2xl font-semibold">
                        {Math.round(weather.temperature)}°C
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {weather.city} · {weatherLook.text}
                      </p>
                    </div>
                  </div>
                ) : city && weatherLoading ? (
                  <p className="text-sm text-muted-foreground">正在获取天气…</p>
                ) : city && weatherError ? (
                  <p className="text-sm text-destructive">
                    找不到「{city}
                    」的天气，换个写法试试（如「杭州」「Hangzhou」）。
                  </p>
                ) : null}
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setCity(cityDraft);
                  }}
                >
                  <input
                    aria-label="城市"
                    value={cityDraft}
                    onChange={(event) => setCityDraft(event.target.value)}
                    placeholder="输入城市，如 杭州"
                    className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm outline-none focus:border-ring"
                  />
                  <button
                    type="submit"
                    className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    保存
                  </button>
                </form>
                {city ? (
                  <button
                    type="button"
                    className="w-fit text-sm text-primary hover:underline"
                    onClick={() => {
                      setPanel(null);
                      onOpen(
                        "https://www.bing.com/search?q=" +
                          encodeURIComponent(
                            `${weather?.city ?? city} 天气预报`,
                          ),
                      );
                    }}
                  >
                    查看未来几天的预报
                  </button>
                ) : null}
              </div>
            ) : panel === "account" ? (
              <>
                <p className="mb-4 text-sm font-medium">
                  {user?.username || "本地账号"}
                </p>
                <button
                  type="button"
                  className="browser-start-setting-row"
                  onClick={() => navigate("/settings?section=account")}
                >
                  账号设置
                  <ArrowUpRight size={16} />
                </button>
              </>
            ) : (
              <>
                <p className="mb-3 text-xs font-medium text-muted-foreground">
                  主页背景
                </p>
                <div className="browser-start-wallpapers">
                  {wallpaperOptions.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      aria-pressed={image.id === item.id}
                      onClick={() => chooseWallpaper(item.id)}
                    >
                      {item.isCosmos ? (
                        <span className="browser-start-wallpaper-preview-cosmos" />
                      ) : item.url ? (
                        <img src={item.url} alt="" />
                      ) : (
                        <span className="browser-start-wallpaper-preview-cosmos" />
                      )}
                      <span>{item.name}</span>
                    </button>
                  ))}
                </div>
                <input
                  ref={uploadRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="上传自定义壁纸"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(event) => {
                    uploadWallpaper(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="browser-start-setting-row mt-3"
                  disabled={uploading}
                  onClick={() => uploadRef.current?.click()}
                >
                  {uploading
                    ? "正在保存…"
                    : customWallpaper
                      ? "更换自定义壁纸"
                      : "上传自定义壁纸"}
                  <ArrowUpRight size={16} />
                </button>
                <p className="mt-2 text-xs text-muted-foreground">
                  支持 JPG、PNG、WebP，最大 2 MB，仅保存在当前浏览器。
                </p>
                {uploadError && (
                  <p role="alert" className="mt-2 text-xs text-destructive">
                    {uploadError}
                  </p>
                )}
                {panel === "settings" && (
                  <label className="mt-6 block text-sm">
                    搜索引擎
                    <select
                      className="browser-start-app-search mt-2"
                      value={selectedEngine}
                      onChange={(event) =>
                        onEngineChange(Number(event.target.value))
                      }
                    >
                      {engines.map((engine, index) => (
                        <option key={engine.name} value={index}>
                          {engine.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  className="browser-start-setting-row mt-5"
                  onClick={manageDesktop}
                >
                  管理应用与小组件
                  <ArrowUpRight size={16} />
                </button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
