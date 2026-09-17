import { useContext, useEffect, useRef, useState } from "react";
import { Loader2Icon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { FileReferenceChip } from "@/components/ui/file-reference-chip";
import { authHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";
import {
  FileReferenceScope,
  resolveFileReference,
} from "@/core/navigation/file-reference";
import {
  artifactRefFromMarkdownHref,
  dispatchOpenArtifact,
} from "@/core/artifacts/open-artifact";
import { useI18n } from "@/core/i18n/hooks";
import { quoteIntoTask } from "@/core/threads/task-interaction";
import { MediaReference } from "./media-reference";

export function LinkedFileReference({
  path,
  lines,
  label,
}: {
  path: string;
  lines?: string;
  label?: string;
}) {
  const scope = useContext(FileReferenceScope);
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string>();
  const [error, setError] = useState<string>();
  const [truncated, setTruncated] = useState(false);
  const [media, setMedia] = useState<{ url: string; type: string }>();
  const lineRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLPreElement>(null);
  const [selection, setSelection] = useState<{ text: string; lines: string }>();
  const [fingerprint, setFingerprint] = useState("");
  const resolvedPath = resolveFileReference(path, scope.basePath);
  const line = Number(lines?.split("-")[0]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setContent(undefined);
    setError(undefined);
    setMedia(undefined);
    setTruncated(false);
    setSelection(undefined);
    setFingerprint("");
    let objectUrl: string | undefined;
    const binary =
      !/\.(?:txt|md|markdown|json|jsonl|ya?ml|toml|ini|conf|log|csv|tsv|py|pyi|ts|tsx|js|jsx|mjs|cjs|css|scss|html?|xml|svg|sql|sh|ps1|bat|cmd|c|h|cpp|hpp|rs|go|java|kt|swift|rb|php|vue|svelte)$/i.test(
        path,
      );
    const params = new URLSearchParams({
      path: resolvedPath,
      max_lines: "5000",
    });
    if (scope.threadId) params.set("thread_id", scope.threadId);
    void fetch(
      `${getBackendBaseURL()}/api/fs/${binary ? "preview" : "read"}?${params}`,
      { headers: authHeaders(), signal: controller.signal },
    )
      .then(async (res) => {
        if (!res.ok)
          throw new Error(
            zh
              ? `文件暂时无法读取（${res.status}）`
              : `Unable to read file (${res.status})`,
          );
        if (binary) {
          const blob = await res.blob();
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setMedia({ url: objectUrl, type: blob.type });
          return;
        }
        const data = (await res.json()) as {
          content: string;
          truncated?: boolean;
        };
        if (controller.signal.aborted) return;
        setContent(data.content);
        setTruncated(Boolean(data.truncated));
        if (crypto.subtle) {
          const digest = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(data.content),
          );
          if (!controller.signal.aborted)
            setFingerprint(
              Array.from(new Uint8Array(digest), (b) =>
                b.toString(16).padStart(2, "0"),
              ).join(""),
            );
        }
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, path, resolvedPath, scope.threadId, zh]);
  useEffect(() => {
    if (content !== undefined)
      lineRef.current?.scrollIntoView?.({ block: "center" });
  }, [content]);
  const openFile = () => {
    const artifact = artifactRefFromMarkdownHref(path);
    if (
      artifact?.startsWith("workspace-output:") &&
      dispatchOpenArtifact(artifact)
    )
      return;
    setOpen(true);
  };
  return (
    <>
      <FileReferenceChip
        path={path}
        lines={lines}
        label={label}
        onClick={openFile}
        className="text-primary"
      />
      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>{path.split(/[\\/]/).pop()}</DialogTitle>
              <DialogDescription className="break-all">
                {resolvedPath}
              </DialogDescription>
            </DialogHeader>
            {error ? (
              <p role="alert">{error}</p>
            ) : media ? (
              <>
                {media.type.startsWith("image/") ||
                media.type === "application/pdf" ? (
                  <MediaReference
                    url={media.url}
                    type={media.type}
                    path={resolvedPath}
                    zh={zh}
                    onQuote={
                      scope.threadId
                        ? (reference) => {
                            quoteIntoTask(scope.threadId, reference);
                            setOpen(false);
                          }
                        : undefined
                    }
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {zh
                      ? "此文件可下载后打开。"
                      : "Download this file to open it."}
                  </p>
                )}
                <a
                  className="text-primary underline"
                  href={media.url}
                  download={path.split(/[\\/]/).pop()}
                >
                  {zh ? "下载文件" : "Download file"}
                </a>
              </>
            ) : content === undefined ? (
              <Loader2Icon
                aria-label={zh ? "正在读取" : "Loading"}
                className="size-5 animate-spin"
              />
            ) : (
              <pre
                ref={textRef}
                onMouseUp={() => {
                  const selected = window.getSelection();
                  if (
                    !selected ||
                    selected.isCollapsed ||
                    !textRef.current?.contains(selected.anchorNode) ||
                    !textRef.current.contains(selected.focusNode)
                  ) {
                    setSelection(undefined);
                    return;
                  }
                  const numberOf = (node: Node | null) =>
                    Number(
                      (node?.nodeType === Node.ELEMENT_NODE
                        ? (node as Element)
                        : node?.parentElement
                      )
                        ?.closest("[data-source-line]")
                        ?.getAttribute("data-source-line"),
                    );
                  const first = numberOf(selected.anchorNode),
                    last = numberOf(selected.focusNode);
                  if (first && last)
                    setSelection({
                      text: selected.toString().slice(0, 6000),
                      lines: `${Math.min(first, last)}-${Math.max(first, last)}`,
                    });
                }}
                className="max-h-[65vh] overflow-auto rounded-lg bg-muted/40 p-3 text-xs leading-6"
              >
                {content.split("\n").map((text, index) => (
                  <span
                    key={index}
                    data-source-line={index + 1}
                    ref={index + 1 === line ? lineRef : undefined}
                    className={`block ${index + 1 >= line && index + 1 <= Number(lines?.split("-")[1] || line) ? "bg-primary/10" : ""}`}
                  >
                    <span className="mr-4 inline-block w-9 select-none text-right text-muted-foreground">
                      {index + 1}
                    </span>
                    {text || " "}
                  </span>
                ))}
              </pre>
            )}
            {truncated && (
              <p className="text-xs text-muted-foreground">
                {zh ? "显示前 5000 行" : "Showing the first 5000 lines"}
              </p>
            )}
            {content !== undefined && scope.threadId && (
              <button
                className="justify-self-start rounded-md border px-3 py-2 text-sm"
                onClick={() => {
                  quoteIntoTask(
                    scope.threadId,
                    `文件：${resolvedPath}${selection ? `:${selection.lines}` : lines ? `:${lines}` : ""}\n${fingerprint ? `预览内容 SHA-256：${fingerprint}\n` : ""}${truncated ? "（预览已截断）\n" : ""}${selection?.text ?? "请针对这个文件提出修改意见。"}`,
                  );
                  setOpen(false);
                }}
              >
                {selection
                  ? zh
                    ? "引用选中内容提修改意见"
                    : "Comment on selection"
                  : zh
                    ? "引用此文件"
                    : "Reference this file"}
              </button>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
