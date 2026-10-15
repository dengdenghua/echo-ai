import {
  type CapabilityCategoryId,
  CAPABILITY_CATEGORIES,
  capabilityCategory,
} from "./capability-categories";
import { serializeComposerDraft } from "@/core/threads/composer-capability-refs";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { serviceErrorMessage } from "@/core/utils/service-error";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { oauthAuthorize } from "@/core/mcp/api";
import {
  cancelCapabilityDeviceFlow,
  connectCapability,
  disconnectCapability,
  getCapabilityInstallPlan,
  getCapabilityDeviceFlow,
  getCapabilityStatus,
  installCapability,
  listCapabilities,
  setCapabilityEnabled,
  uninstallCapability,
  type CapabilityInfo,
  type CapabilityInstallPlan,
  type CapabilitySource,
} from "@/core/agents/agent-world-api";
import { ACCOUNT_FREE_TOKEN, getToken } from "@/core/auth/api";
import { CAPABILITY_SURFACE_QUERY_KEY } from "@/core/plugins/use-capability-surface";
import { cn } from "@/lib/utils";

import { pollOAuth, supportsDeviceFlow } from "./capability-auth-flow";
import { ConnectDialog } from "./capability-connect-dialog";
import {
  CapabilityCategoryHeader,
  CapabilityMarketCard,
} from "./capability-market-card";
import {
  CapabilityMarketToolbar,
  type CapabilityTypeFilter,
} from "./capability-market-toolbar";
import { OAuthAppDialog } from "./capability-oauth-app-dialog";
import { PermissionReviewDialog } from "./capability-permission-review-dialog";
import {
  openExternalAuthPopup,
  safeExternalAuthUrl,
} from "./external-auth-url";
import { BrandLoadingPanel } from "@/components/brand/brand-progress";

// 统一「插件」市场 —— 所有外部能力(WorkBuddy MCP 服务、Codex 插件、注册表插件)统一叫插件。
// 一个市场统一管理:安装→技能/MCP,连接→认证编排,插件直接就绪。
// 数据来自后端 /api/capabilities(见 runtime/sensing/gateway/capability_router.py)。

// settings/opencode-connections.tsx 从这里引用连接弹窗。
export { ConnectDialog };

export type CapabilityMarketView = "featured" | "all" | "installed";

export interface CapabilityMarketPanelProps {
  /** 上层市场搜索词；与面板自己的搜索词同时生效。 */
  searchQuery?: string;
  /** 精选、全部或仅已安装。默认保持原来的全部市场。 */
  view?: CapabilityMarketView;
  /** 精选视图按这里的 ID 顺序展示，不补造排行或热度数据。 */
  featuredIds?: readonly string[];
  /** 最多展示多少项。 */
  maxItems?: number;
  /** 是否显示原有类型、搜索和刷新工具栏。 */
  showToolbar?: boolean;
  /** 只展示指定来源；Codex 插件与连接器仍复用同一套生命周期。 */
  source?: CapabilitySource | "";
  /** 使用接近 Codex 桌面端插件目录的紧凑双列列表。 */
  compact?: boolean;
  /** Exact role requirements, including manual-token connectors. No fuzzy replacements. */
  requiredCapabilityIds?: readonly string[];
}

const CAPABILITY_PAGE_SIZE = 60;
const CAPABILITY_CATEGORY_STATE_KEY = "echoai.plugin-category-collapse.v1";

function capabilityMatchesQuery(capability: CapabilityInfo, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    capability.name,
    capability.name_zh,
    capability.id,
    capability.description,
    capability.description_zh,
    capability.author,
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

export function CapabilityMarketPanel({
  searchQuery = "",
  view = "all",
  featuredIds = [],
  maxItems,
  showToolbar = true,
  source = "",
  compact = false,
  requiredCapabilityIds,
}: CapabilityMarketPanelProps = {}) {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirmDialog();
  const isAccountFree = getToken() === ACCOUNT_FREE_TOKEN;
  const [loadedOffset, setLoadedOffset] = useState(0);
  const [items, setItems] = useState<CapabilityInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const serverQuery = useDeferredValue(searchQuery.trim() || query.trim());
  const [typeFilter, setTypeFilter] = useState<CapabilityTypeFilter>("all");
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});
  const [statusMap, setStatusMap] = useState<Record<string, boolean>>({});
  const [statusErrors, setStatusErrors] = useState<
    Record<string, string | null>
  >({});
  /** 显示只能手动填 token 的插件(默认隐藏,对齐「都能跳网页授权」)。 */
  const [showManual, setShowManual] = useState(Boolean(requiredCapabilityIds?.length));
  const [collapsedCategories, setCollapsedCategories] = useState<
    Partial<Record<CapabilityCategoryId, boolean>>
  >(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(
        window.localStorage.getItem(CAPABILITY_CATEGORY_STATE_KEY) || "{}",
      ) as Partial<Record<CapabilityCategoryId, boolean>>;
    } catch {
      return {};
    }
  });
  const [connectTarget, setConnectTarget] = useState<CapabilityInfo | null>(
    null,
  );
  const pendingTryRef = useRef<CapabilityInfo | null>(null);
  const [permissionReview, setPermissionReview] = useState<{
    capability: CapabilityInfo;
    mode: "install" | "enable";
    plan: CapabilityInstallPlan | null;
    loading: boolean;
    busy: boolean;
    error: string | null;
  } | null>(null);
  const [oauthAppDialog, setOAuthAppDialog] = useState<{
    provider: string;
    providerName: string;
    docsUrl: string;
    redirectUri: string;
    server: string;
    url: string;
    cap: CapabilityInfo;
  } | null>(null);

  const load = useCallback(
    async (offset = 0) => {
      if (isAccountFree) {
        setItems([]);
        setTotal(0);
        setLoadedOffset(0);
        setError("免账号模式仅支持本地内置能力，云端插件需登录后查看。");
        setLoading(false);
        setLoadingMore(false);
        return;
      }
      const append = offset > 0;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        // Featured and installed views need the complete catalog for their
        // client-side predicates. The high-volume full market is page-backed.
        const paged = view === "all";
        const res = await listCapabilities({
          search: serverQuery || undefined,
          source,
          limit: paged ? CAPABILITY_PAGE_SIZE : 500,
          offset: paged ? offset : 0,
          includeManual: showManual,
        });
        setItems((current) =>
          Array.from(
            new Map(
              (append
                ? [...current, ...res.capabilities]
                : res.capabilities
              ).map((cap) => [cap.id, cap]),
            ).values(),
          ),
        );
        setTotal(res.total);
        setLoadedOffset(offset + res.capabilities.length);
      } catch (err) {
        setError(serviceErrorMessage(err));
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [isAccountFree, serverQuery, showManual, source, view],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // 拉取已安装能力的连接状态
  const refreshStatus = useCallback(async (installed: CapabilityInfo[]) => {
    const next: Record<string, boolean> = {};
    const errors: Record<string, string | null> = {};
    await Promise.all(
      installed.map(async (c) => {
        try {
          const st = await getCapabilityStatus(c.id);
          next[c.id] = !!st.connected;
          errors[c.id] = null;
        } catch (error) {
          errors[c.id] = serviceErrorMessage(error);
        }
      }),
    );
    setStatusMap((prev) => ({ ...prev, ...next }));
    setStatusErrors((prev) => ({ ...prev, ...errors }));
  }, []);

  useEffect(() => {
    const installed = items.filter((c) => c.installed);
    if (installed.length) void refreshStatus(installed);
  }, [items, refreshStatus]);

  const setBusy = (id: string, busy: boolean) =>
    setBusyMap((m) => ({ ...m, [id]: busy }));

  const viewItems = useMemo(() => {
    if (view === "installed") {
      return items.filter((capability) => capability.installed);
    }
    if (view !== "featured") return items;

    const firstById = new Map<string, CapabilityInfo>();
    for (const capability of items) {
      const identities = [
        capability.id,
        capability.provider_id,
        capability.codex_plugin_id,
        capability.plugin_name,
      ].filter((identity): identity is string => Boolean(identity));
      for (const identity of identities) {
        if (!firstById.has(identity)) {
          firstById.set(identity, capability);
        }
      }
    }
    const seen = new Set<string>();
    return featuredIds.flatMap((id) => {
      const capability = firstById.get(id);
      if (!capability || seen.has(capability.id)) return [];
      seen.add(capability.id);
      return capability ? [capability] : [];
    });
  }, [featuredIds, items, view]);

  const filtered = viewItems.filter((c) => {
    if (requiredCapabilityIds && !requiredCapabilityIds.includes(c.id)) return false;
    if (typeFilter !== "all" && c.type !== typeFilter) return false;
    return (
      capabilityMatchesQuery(c, searchQuery) && capabilityMatchesQuery(c, query)
    );
  });
  const visibleItems =
    typeof maxItems === "number"
      ? filtered.slice(0, Math.max(0, Math.floor(maxItems)))
      : filtered;
  const isFeaturedView = view === "featured";
  const categorizedSections = useMemo(() => {
    if (!compact || view !== "all" || typeof maxItems === "number") return [];
    const buckets = new Map<CapabilityCategoryId, CapabilityInfo[]>();
    for (const category of CAPABILITY_CATEGORIES) buckets.set(category.id, []);
    for (const capability of visibleItems) {
      if (capability.installed) {
        buckets.get("installed")?.push(capability);
      } else {
        buckets.get(capabilityCategory(capability))?.push(capability);
      }
    }
    return CAPABILITY_CATEGORIES.map((category) => ({
      ...category,
      items: buckets.get(category.id) ?? [],
    })).filter((category) => category.items.length > 0);
  }, [compact, maxItems, view, visibleItems]);
  const showCategorizedSections = categorizedSections.length > 0;
  const searchActive = Boolean(searchQuery.trim() || query.trim());
  const marketRows = useMemo(() => {
    if (!showCategorizedSections) {
      return visibleItems.map((capability) => ({
        kind: "capability" as const,
        capability,
      }));
    }
    return categorizedSections.flatMap((section) => {
      const collapsed =
        !searchActive && Boolean(collapsedCategories[section.id]);
      return [
        { kind: "section" as const, section, collapsed },
        ...(collapsed
          ? []
          : section.items.map((capability) => ({
              kind: "capability" as const,
              capability,
            }))),
      ];
    });
  }, [
    categorizedSections,
    collapsedCategories,
    searchActive,
    showCategorizedSections,
    visibleItems,
  ]);

  const toggleCategory = (category: CapabilityCategoryId) => {
    setCollapsedCategories((current) => {
      const next = { ...current, [category]: !current[category] };
      try {
        window.localStorage.setItem(
          CAPABILITY_CATEGORY_STATE_KEY,
          JSON.stringify(next),
        );
      } catch {
        // Browsers with storage disabled still keep the state for this visit.
      }
      return next;
    });
  };

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: items.length };
    for (const c of items) {
      out[c.type] = (out[c.type] ?? 0) + 1;
    }
    return out;
  }, [items]);

  const performInstall = async (
    cap: CapabilityInfo,
    reviewedPlan: CapabilityInstallPlan | null,
  ) => {
    setBusy(cap.id, true);
    if (reviewedPlan) {
      setPermissionReview((current) =>
        current ? { ...current, busy: true, error: null } : current,
      );
    }
    setError(null);
    setNotice(null);
    try {
      const res = await installCapability(cap.id, reviewedPlan?.plan_id);
      const permissions =
        res.permissions ?? reviewedPlan?.permissions ?? cap.permissions ?? [];
      let enabledAfterInstall = res.enabled ?? false;
      setItems((prev) =>
        prev.map((c) =>
          c.id === cap.id
            ? {
                ...c,
                installed: true,
                enabled: enabledAfterInstall,
                permissions,
                permission_review_required:
                  res.permission_review_required ?? permissions.length > 0,
                permission_active: enabledAfterInstall,
              }
            : c,
        ),
      );
      if (reviewedPlan) {
        if (cap.model_provider) {
          setPermissionReview(null);
          setConnectTarget({
            ...cap,
            installed: true,
            permissions_granted: permissions,
          });
          return;
        }
        await setCapabilityEnabled(cap.id, true, permissions);
        enabledAfterInstall = true;
        setItems((prev) =>
          prev.map((c) =>
            c.id === cap.id
              ? {
                  ...c,
                  installed: true,
                  enabled: true,
                  permissions,
                  permissions_granted: permissions,
                  permission_review_required: false,
                  permission_active: true,
                }
              : c,
          ),
        );
      }
      // CLI 连接器生命周期提示(init/版本)不阻断安装
      const cli = res.cli_lifecycle;
      if (cli?.has_cli) {
        const msgs: string[] = [];
        if (cli.init && !cli.init.ok && cli.init.error) {
          msgs.push(`CLI 工具未装好:${cli.init.error}`);
        }
        if (cli.version && !cli.version.ok && cli.version.error) {
          msgs.push(`版本提示:${cli.version.error}`);
        }
        if (msgs.length) setNotice(msgs.join(" "));
      }
      void refreshStatus([
        { ...cap, installed: true, enabled: enabledAfterInstall },
      ]);
      void queryClient.invalidateQueries({
        queryKey: CAPABILITY_SURFACE_QUERY_KEY,
      });
      if (reviewedPlan) setPermissionReview(null);
    } catch (err) {
      const message = serviceErrorMessage(err);
      if (reviewedPlan) {
        setPermissionReview((current) =>
          current ? { ...current, busy: false, error: message } : current,
        );
      } else {
        setError(message);
      }
    } finally {
      setBusy(cap.id, false);
      if (reviewedPlan) {
        setPermissionReview((current) =>
          current ? { ...current, busy: false } : current,
        );
      }
    }
  };

  const openPermissionReview = async (
    cap: CapabilityInfo,
    mode: "install" | "enable",
  ) => {
    if (isAccountFree) {
      setPermissionReview(null);
      setError("免账号模式无法读取插件签名，请登录后安装或启用。");
      return;
    }
    setPermissionReview({
      capability: cap,
      mode,
      plan: null,
      loading: true,
      busy: false,
      error: null,
    });
    try {
      const plan = await getCapabilityInstallPlan(cap.id);
      setPermissionReview((current) =>
        current?.capability.id === cap.id
          ? { ...current, plan, loading: false }
          : current,
      );
    } catch (err) {
      const message = serviceErrorMessage(err);
      setPermissionReview((current) =>
        current?.capability.id === cap.id
          ? { ...current, loading: false, error: message }
          : current,
      );
    }
  };

  const onInstall = async (cap: CapabilityInfo) => {
    if (isAccountFree) {
      setError("免账号模式无法安装外部插件，请登录后重试。");
      return;
    }
    if (cap.is_codex_marketplace) {
      await performInstall(cap, null);
      return;
    }
    await openPermissionReview(cap, "install");
  };

  const onUninstall = async (cap: CapabilityInfo) => {
    if (
      !(await confirm({
        title: `卸载“${cap.name_zh || cap.name}”？`,
        description:
          "该插件将停止为本机任务提供能力，并结束尚未完成的授权连接。之后可在此重新安装。",
        confirmLabel: "卸载插件",
      }))
    )
      return;
    setBusy(cap.id, true);
    setError(null);
    setNotice(null);
    try {
      if (supportsDeviceFlow(cap)) {
        const status = await getCapabilityDeviceFlow(cap.id);
        if (status.active && status.device_flow) {
          const cancellation = await cancelCapabilityDeviceFlow(
            cap.id,
            status.device_flow.flow_id,
          );
          if (!cancellation.cancelled) {
            setNotice(
              cancellation.reason === "generation_mismatch"
                ? "授权会话已被新窗口替换，将由卸载操作统一回收最新会话。"
                : "未发现可取消的授权会话，继续执行卸载。",
            );
          }
        }
      }
      await uninstallCapability(cap.id);
      setItems((prev) =>
        prev.map((c) =>
          c.id === cap.id ? { ...c, installed: false, enabled: false } : c,
        ),
      );
      setStatusMap((m) => ({ ...m, [cap.id]: false }));
      void queryClient.invalidateQueries({
        queryKey: CAPABILITY_SURFACE_QUERY_KEY,
      });
    } catch (err) {
      setError(serviceErrorMessage(err));
    } finally {
      setBusy(cap.id, false);
    }
  };

  const onDisable = async (cap: CapabilityInfo) => {
    setBusy(cap.id, true);
    setError(null);
    try {
      await setCapabilityEnabled(cap.id, false);
      setItems((current) =>
        current.map((item) =>
          item.id === cap.id ? { ...item, enabled: false } : item,
        ),
      );
      void queryClient.invalidateQueries({
        queryKey: CAPABILITY_SURFACE_QUERY_KEY,
      });
    } catch (err) {
      setError(serviceErrorMessage(err));
    } finally {
      setBusy(cap.id, false);
    }
  };

  const openTrialConversation = (cap: CapabilityInfo) => {
    const prompt = serializeComposerDraft({
      refs: [{ type: "plugin", id: cap.codex_plugin_id || cap.id }],
      body: "",
    });
    window.location.hash = `/workspace/realtime/new?prompt=${encodeURIComponent(prompt)}`;
  };

  const onTry = async (cap: CapabilityInfo) => {
    if (cap.is_codex_marketplace || cap.enabled || cap.model_provider) {
      openTrialConversation(cap);
      return;
    }
    if (cap.permission_review_required) {
      pendingTryRef.current = cap;
      await openPermissionReview(cap, "enable");
      return;
    }
    setBusy(cap.id, true);
    setError(null);
    try {
      await setCapabilityEnabled(cap.id, true);
      void queryClient.invalidateQueries({
        queryKey: CAPABILITY_SURFACE_QUERY_KEY,
      });
      openTrialConversation(cap);
    } catch (err) {
      setError(serviceErrorMessage(err));
    } finally {
      setBusy(cap.id, false);
    }
  };

  const confirmPermissionReview = async () => {
    const review = permissionReview;
    if (!review?.plan?.can_install) return;
    if (review.mode === "install") {
      await performInstall(review.capability, review.plan);
      return;
    }
    const permissions = review.plan.permissions;
    if (review.capability.model_provider) {
      setPermissionReview(null);
      setConnectTarget({
        ...review.capability,
        permissions_granted: permissions,
      });
      return;
    }
    setBusy(review.capability.id, true);
    setPermissionReview({ ...review, busy: true, error: null });
    try {
      await setCapabilityEnabled(
        review.capability.id,
        true,
        permissions,
        review.plan.plan_id,
      );
      setItems((current) =>
        current.map((capability) =>
          capability.id === review.capability.id
            ? {
                ...capability,
                enabled: true,
                permissions,
                permissions_granted: permissions,
                permission_review_required: false,
                permission_active: true,
              }
            : capability,
        ),
      );
      setPermissionReview(null);
      if (pendingTryRef.current?.id === review.capability.id) {
        pendingTryRef.current = null;
        openTrialConversation(review.capability);
      }
      void queryClient.invalidateQueries({
        queryKey: CAPABILITY_SURFACE_QUERY_KEY,
      });
    } catch (err) {
      setPermissionReview((current) =>
        current
          ? {
              ...current,
              busy: false,
              error: serviceErrorMessage(err),
            }
          : current,
      );
    } finally {
      setBusy(review.capability.id, false);
    }
  };

  const onDisconnect = async (cap: CapabilityInfo) => {
    setBusy(cap.id, true);
    setError(null);
    try {
      await disconnectCapability(cap.id);
      setStatusMap((m) => ({ ...m, [cap.id]: false }));
    } catch (err) {
      setError(serviceErrorMessage(err));
    } finally {
      setBusy(cap.id, false);
    }
  };

  // 跑一遍「网页授权」:authorize → 弹窗 → 轮询回调结果。
  const runWebOAuth = async (
    cap: CapabilityInfo,
    server: string,
    url: string,
  ) => {
    const {
      authorize_url,
      needs_app_credentials,
      provider,
      provider_name,
      docs_url,
      redirect_uri,
      callback_transport,
    } = await oauthAuthorize(server, url, cap.oauth_provider ?? undefined);
    // 服务商直连 OAuth(GitHub 等)还没配置 OAuth App 凭据 → 引导用户填写
    if (needs_app_credentials && provider) {
      setOAuthAppDialog({
        provider,
        providerName: provider_name ?? provider,
        docsUrl: docs_url ?? "",
        redirectUri: redirect_uri ?? "",
        server,
        url,
        cap,
      });
      return;
    }
    if (
      callback_transport === "desktop-deep-link" &&
      !window.echo?.isElectron
    ) {
      setError(
        "该服务商使用桌面客户端回跳，请在 ECHO AI 桌面版中完成授权。浏览器版无法安全接收授权结果。",
      );
      return;
    }
    if (!safeExternalAuthUrl(authorize_url)) {
      setError("授权地址不是 http(s) 链接,已拒绝打开");
      return;
    }
    const popup = openExternalAuthPopup(
      authorize_url,
      "echo-mcp-oauth",
      "popup=yes,width=560,height=720",
    );
    if (!popup) {
      setError("授权窗口被浏览器拦截,请允许弹窗后重试");
      return;
    }
    const ok = await pollOAuth(server);
    if (ok) {
      setStatusMap((m) => ({ ...m, [cap.id]: true }));
    } else {
      setError("未完成网页授权(超时或取消),可重试或改用手动填写凭据");
    }
  };

  const openConnect = async (cap: CapabilityInfo) => {
    if (["opencode-zen", "opencode-go"].includes(cap.id)) {
      window.dispatchEvent(
        new CustomEvent("echo:open-settings", { detail: { tab: "models" } }),
      );
      return;
    }
    // 插件(Codex)无需认证,直接确认就绪
    if (cap.source === "codex_plugin") {
      setBusy(cap.id, true);
      void connectCapability(cap.id)
        .then(() => {
          setStatusMap((m) => ({ ...m, [cap.id]: true }));
        })
        .catch((err) => setError(serviceErrorMessage(err)))
        .finally(() => setBusy(cap.id, false));
      return;
    }

    // OneID(腾讯统一身份)特例:走 oneid-token 专用流程,不尝试网页 OAuth。
    if (cap.auth_mode === "oneid-token") {
      setConnectTarget(cap);
      return;
    }

    // MCP 型插件:优先走「网页登录授权」——打开服务商授权页,登录授权后回调。
    // 服务商不支持网页授权时才回退到手动填 token。
    const mcp = (cap.mcp_servers ?? []).find((s) => s && s.url);
    if (mcp) {
      setBusy(cap.id, true);
      setError(null);
      try {
        await runWebOAuth(cap, mcp.name, mcp.url);
      } catch {
        // 无 .well-known 发现 + 非服务商直连 OAuth → 回退到手动填写凭据
        setConnectTarget(cap);
      } finally {
        setBusy(cap.id, false);
      }
      return;
    }

    // 其余类型:打开手动填写凭据对话框
    setConnectTarget(cap);
  };

  return (
    <div className="space-y-3">
      {/* 来源 + 类型 + 搜索 */}
      {showToolbar ? (
        <CapabilityMarketToolbar
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          counts={counts}
          visibleCount={visibleItems.length}
          totalCount={viewItems.length}
          query={query}
          onQueryChange={setQuery}
          showManual={showManual}
          onToggleManual={() => setShowManual((v) => !v)}
          loading={loading}
          onRefresh={() => void load()}
        />
      ) : null}

      {error ? (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-md bg-muted px-3 py-2 text-xs text-foreground">
          {notice}
        </div>
      ) : null}

      {loading ? (
        <BrandLoadingPanel
          label="正在读取插件目录…"
          className="min-h-[200px]"
        />
      ) : (
        <div
          className={cn(
            "grid grid-cols-1",
            compact ? "gap-2 lg:grid-cols-2" : "gap-3 sm:grid-cols-2",
            !compact && isFeaturedView
              ? "xl:grid-cols-3"
              : !compact && "lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
          )}
        >
          {marketRows.map((row) =>
            row.kind === "section" ? (
              <CapabilityCategoryHeader
                key={`section-${row.section.id}`}
                id={row.section.id}
                label={row.section.label}
                count={row.section.items.length}
                collapsed={row.collapsed}
                onToggle={() => toggleCategory(row.section.id)}
              />
            ) : (
              <CapabilityMarketCard
                key={`${row.capability.source}:${row.capability.id}`}
                capability={row.capability}
                compact={compact}
                featured={isFeaturedView}
                busy={busyMap[row.capability.id]}
                connected={statusMap[row.capability.id]}
                statusError={statusErrors[row.capability.id]}
                onInstall={onInstall}
                onTry={onTry}
                onReviewPermissions={(cap) =>
                  openPermissionReview(cap, "enable")
                }
                onConnect={openConnect}
                onDisable={onDisable}
                onDisconnect={onDisconnect}
                onUninstall={onUninstall}
                onRefreshStatus={(cap) => refreshStatus([cap])}
              />
            ),
          )}
          {visibleItems.length === 0 && !loading && (
            <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
              {serverQuery
                ? `没有与“${serverQuery}”匹配的插件`
                : view === "featured"
                  ? "暂无精选应用"
                  : view === "installed"
                    ? "还没有已安装应用"
                    : "没有匹配的应用"}
            </div>
          )}
        </div>
      )}

      {!loading && view === "all" && loadedOffset < total ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mx-auto flex"
          disabled={loadingMore}
          onClick={() => void load(loadedOffset)}
        >
          {loadingMore ? "加载中…" : `加载更多(${total - loadedOffset})`}
        </Button>
      ) : null}

      {confirmDialog}
      {permissionReview ? (
        <PermissionReviewDialog
          capability={permissionReview.capability}
          mode={permissionReview.mode}
          plan={permissionReview.plan}
          loading={permissionReview.loading}
          busy={permissionReview.busy}
          error={permissionReview.error}
          onClose={() => setPermissionReview(null)}
          onConfirm={() => void confirmPermissionReview()}
        />
      ) : null}

      {connectTarget ? (
        <ConnectDialog
          capability={connectTarget}
          open={!!connectTarget}
          onOpenChange={(open) => {
            if (!open) setConnectTarget(null);
          }}
          onConnected={() => {
            if (connectTarget.model_provider) {
              setItems((current) =>
                current.map((cap) =>
                  cap.id === connectTarget.id
                    ? {
                        ...cap,
                        enabled: true,
                        permission_active: true,
                        permission_review_required: false,
                        permissions_granted: connectTarget.permissions_granted,
                      }
                    : cap,
                ),
              );
              void queryClient.invalidateQueries({
                queryKey: CAPABILITY_SURFACE_QUERY_KEY,
              });
            }
            setStatusMap((m) => ({
              ...m,
              [connectTarget.id]: true,
            }));
          }}
        />
      ) : null}

      {oauthAppDialog ? (
        <OAuthAppDialog
          open
          provider={oauthAppDialog.provider}
          providerName={oauthAppDialog.providerName}
          docsUrl={oauthAppDialog.docsUrl}
          redirectUri={oauthAppDialog.redirectUri}
          onOpenChange={(open) => {
            if (!open) setOAuthAppDialog(null);
          }}
          onSaved={async () => {
            const dlg = oauthAppDialog;
            setOAuthAppDialog(null);
            if (!dlg) return;
            setBusy(dlg.cap.id, true);
            setError(null);
            try {
              await runWebOAuth(dlg.cap, dlg.server, dlg.url);
            } catch {
              setConnectTarget(dlg.cap);
            } finally {
              setBusy(dlg.cap.id, false);
            }
          }}
        />
      ) : null}
    </div>
  );
}
