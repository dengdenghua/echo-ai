import { CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";
import DOMPurify from "dompurify";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { copyTextToClipboard } from "@/core/clipboard";
import { useI18n } from "@/core/i18n/hooks";
import { swallow } from "@/core/utils/log";
import { cn } from "@/lib/utils";

type MermaidRenderResult = {
  svg: string;
  bindFunctions?: (element: Element) => void;
};

type MermaidRuntime = {
  initialize?: (config?: Record<string, unknown>) => void;
  render: (
    id: string,
    source: string,
  ) => MermaidRenderResult | Promise<MermaidRenderResult>;
};

// Mermaid configuration is global: serialize initialize + render across blocks.
let mermaidRenderQueue: Promise<unknown> = Promise.resolve();

type MermaidBlockProps = {
  code: string;
  isStreaming?: boolean;
  className?: string;
};

export function MermaidBlock({
  code,
  isStreaming = false,
  className,
}: MermaidBlockProps) {
  const rootId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState("");
  const [zoom, setZoom] = useState(1);
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false,
  );
  const [exportError, setExportError] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bindFunctions, setBindFunctions] = useState<
    ((element: Element) => void) | null
  >(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const trimmedCode = code.trim();
  // DOMPurify sanitizes the rendered SVG before insertion (audit C3/M4):
  // Mermaid's strict security mode is good, but this is an independent layer
  // against injected <script>/event handlers surviving render.
  const sanitizedSvg = useMemo(() => {
    const clean = DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
    });
    if (!clean) return "";
    const element = new DOMParser().parseFromString(
      clean,
      "image/svg+xml",
    ).documentElement;
    if (element.tagName !== "svg") return "";
    // Persist sizing in the markup: React may replace innerHTML on any render.
    element.setAttribute(
      "style",
      `${element.getAttribute("style") || ""};max-width:none;width:100%;height:auto`,
    );
    return element.outerHTML;
  }, [svg]);

  useEffect(() => {
    if (isStreaming || !trimmedCode) {
      setSvg("");
      setError(null);
      setBindFunctions(null);
      return;
    }

    let cancelled = false;
    setSvg("");
    setError(null);
    setBindFunctions(null);

    void (async () => {
      try {
        const mod = (await import("mermaid-real")) as {
          default: MermaidRuntime;
        };
        if (cancelled) return;
        const mermaid = mod.default;
        const job = mermaidRenderQueue.then(async () => {
          if (cancelled) return null;
          mermaid.initialize?.({
            startOnLoad: false,
            securityLevel: "strict",
            theme: "base",
            themeVariables: {
              darkMode: dark,
              background: dark ? "#161617" : "#ffffff",
              mainBkg: dark ? "#202022" : "#fdf7fa",
              nodeBorder: dark ? "#38383c" : "#e2e2e2",
              primaryColor: dark ? "#2c2c2e" : "#f8eaf0",
              primaryTextColor: dark ? "#f5f5f7" : "#1d1d1f",
              primaryBorderColor: dark ? "#efb0ca" : "#b13f6c",
              lineColor: dark ? "#a1a1a8" : "#6e6e73",
              secondaryColor: dark ? "#202022" : "#f5f5f5",
              tertiaryColor: dark ? "#262628" : "#ffffff",
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
            },
            fontFamily: "inherit",
            htmlLabels: false,
            flowchart: {
              htmlLabels: false,
              useMaxWidth: true,
            },
          });
          return await mermaid.render(
            `mermaid-chat-${rootId}`,
            trimmedCode.replace(
              /<\/?(?:b|strong|i|em|span)(?:\s[^<>]*?)?>/gi,
              "",
            ),
          );
        });
        mermaidRenderQueue = job.catch(() => undefined);
        const result = await job;
        if (cancelled || !result) return;
        setSvg(result.svg);
        setBindFunctions(() => result.bindFunctions ?? null);
      } catch (caught) {
        swallow(caught);
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Render failed");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isStreaming, rootId, trimmedCode, dark]);

  useEffect(() => {
    if (!svg || !containerRef.current) return;
    bindFunctions?.(containerRef.current);
  }, [bindFunctions, svg]);

  if (isStreaming || error || !svg) {
    return (
      <MermaidSourceBlock
        code={code}
        error={error}
        isStreaming={isStreaming}
        className={className}
      />
    );
  }

  return (
    <div
      className={cn(
        "not-prose my-3 overflow-hidden rounded-lg border bg-background text-foreground",
        className,
      )}
    >
      <MermaidBlockHeader code={code} />
      <div className="flex flex-wrap items-center gap-3 border-b px-3 py-1 text-xs">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
        >
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
        >
          +
        </button>
        <button type="button" onClick={() => setZoom(1)}>
          适应宽度
        </button>
        <button type="button" onClick={() => setDark((value) => !value)}>
          {dark ? "浅色" : "深色"}
        </button>
        <button
          type="button"
          onClick={() =>
            downloadVisual(sanitizedSvg, "image/svg+xml", "diagram.svg")
          }
        >
          SVG
        </button>
        <button
          type="button"
          onClick={() => {
            setExportError("");
            void downloadMermaidPng(sanitizedSvg).catch(() =>
              setExportError("PNG 导出失败，可下载 SVG。"),
            );
          }}
        >
          PNG
        </button>
      </div>
      {exportError && (
        <p role="alert" className="px-3 text-xs">
          {exportError}
        </p>
      )}
      <div
        className="max-h-[720px] overflow-auto transition-colors duration-fast"
        style={{
          background: dark
            ? "var(--card, #202022)"
            : "var(--background, #ffffff)",
        }}
      >
        <div
          ref={containerRef}
          style={{
            width: `${zoom * 100}%`,
            minWidth: `${zoom * 100}%`,
            color: dark
              ? "var(--foreground, #f5f5f7)"
              : "var(--foreground, #1d1d1f)",
          }}
          className={cn(
            "overflow-auto bg-muted/15 p-4 animate-fade-in transition-colors duration-fast",
            "[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full",
          )}
          // Mermaid returns SVG markup after applying its own strict security mode,
          // and DOMPurify sanitizes it again before insertion (audit C3/M4).
          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized via DOMPurify.
          dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
        />
      </div>
    </div>
  );
}

function MermaidSourceBlock({
  code,
  error,
  isStreaming,
  className,
}: {
  code: string;
  error: string | null;
  isStreaming: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "not-prose my-3 overflow-hidden rounded-lg border bg-muted/30 text-foreground",
        className,
      )}
    >
      <MermaidBlockHeader code={code} isStreaming={isStreaming} />
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 border-b bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">Mermaid render failed</span>
        </div>
      )}
      <pre className="m-0 overflow-auto bg-transparent p-4 text-sm leading-6 whitespace-pre-wrap">
        <code>{code}</code>
        {isStreaming && (
          <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary/60 align-middle" />
        )}
      </pre>
      {isStreaming && <span className="sr-only">{t.streaming.generating}</span>}
    </div>
  );
}

function MermaidBlockHeader({
  code,
  isStreaming = false,
}: {
  code: string;
  isStreaming?: boolean;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await copyTextToClipboard(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (caught) {
      swallow(caught);
    }
  }, [code]);

  const Icon = copied ? CheckIcon : CopyIcon;

  return (
    <div className="flex h-8 items-center justify-between gap-2 border-b bg-muted/40 px-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground uppercase">
          mermaid
        </span>
        {isStreaming && (
          <>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="animate-pulse text-xs text-muted-foreground">
              {t.streaming.generating}
            </span>
          </>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Copy Mermaid source"
        title="Copy Mermaid source"
        onClick={handleCopy}
      >
        <Icon className="size-3.5" />
      </Button>
    </div>
  );
}

function downloadVisual(data: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadMermaidPng(svg: string): Promise<void> {
  const source = new DOMParser().parseFromString(
    svg,
    "image/svg+xml",
  ).documentElement;
  const box = source.getAttribute("viewBox")?.split(/[ ,]+/).map(Number);
  const width =
    box?.[2] || parseFloat(source.getAttribute("width") || "") || 1200;
  const height =
    box?.[3] || parseFloat(source.getAttribute("height") || "") || 800;
  const scale = Math.min(2, 4096 / Math.max(width, height));
  source.setAttribute("width", String(width));
  source.setAttribute("height", String(height));
  source.style.width = `${width}px`;
  source.style.height = `${height}px`;
  const url = URL.createObjectURL(
    new Blob([source.outerHTML], { type: "image/svg+xml" }),
  );
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = reject;
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error("PNG encoding failed")),
        "image/png",
      ),
    );
    downloadVisual(blob, "image/png", "diagram.png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
