import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import {
  CloudSun,
  Grip,
  Search,
  Settings,
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
}: Props) {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [panel, setPanel] = useState<"apps" | "settings" | "account" | null>(
    null,
  );
  const [appQuery, setAppQuery] = useState("");
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
    try { return localStorage.getItem(CUSTOM_WALLPAPER_KEY) || ""; }
    catch { return ""; }
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
    reader.onerror = () => { setUploading(false); setUploadError("图片读取失败，请重试。"); };
    reader.onload = () => {
      const url = String(reader.result);
      const img = new Image();
      img.onerror = () => { setUploading(false); setUploadError("无法打开这张图片，请换一张。"); };
      img.onload = () => {
        try {
          localStorage.setItem(CUSTOM_WALLPAPER_KEY, url);
          localStorage.setItem(WALLPAPER_KEY_V2, "custom");
          setCustomWallpaper(url);
          setWallpaper("custom");
        } catch { setUploadError("本地存储空间不足，请选择更小的图片。"); }
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
            title="查看天气"
            onClick={() =>
              onOpen(
                "https://www.bing.com/search?q=" +
                  encodeURIComponent("当地天气"),
              )
            }
          >
            <CloudSun size={20} strokeWidth={1.75} />
            <span>天气</span>
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
      <form
        className="browser-start-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <input
          ref={searchInputRef}
          aria-label="搜索网页"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索网页"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
        />
        <button
          type="submit"
          aria-label="搜索"
          title={`使用 ${engines[selectedEngine]?.name ?? "搜索引擎"} 搜索`}
        >
          <Search size={22} strokeWidth={1.8} />
        </button>
      </form>
      {children && <div className="browser-start-task-services bg-background text-foreground">{children}</div>}
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
                  : "主页设置"}
            </DialogTitle>
            <DialogDescription>
              {panel === "apps"
                ? "打开常用网站与 Echo 工作台"
                : panel === "account"
                  ? "当前 Echo 登录账号"
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
                <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp"
                  aria-label="上传自定义壁纸" className="sr-only" disabled={uploading}
                  onChange={event => { uploadWallpaper(event.target.files?.[0]); event.target.value = ""; }} />
                <button type="button" className="browser-start-setting-row mt-3" disabled={uploading}
                  onClick={() => uploadRef.current?.click()}>
                  {uploading ? "正在保存…" : customWallpaper ? "更换自定义壁纸" : "上传自定义壁纸"}
                  <ArrowUpRight size={16} />
                </button>
                <p className="mt-2 text-xs text-muted-foreground">支持 JPG、PNG、WebP，最大 2 MB，仅保存在当前浏览器。</p>
                {uploadError && <p role="alert" className="mt-2 text-xs text-destructive">{uploadError}</p>}
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
