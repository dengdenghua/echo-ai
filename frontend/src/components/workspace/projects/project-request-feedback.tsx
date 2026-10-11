import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const PROJECT_LOAD_ERROR_MESSAGE = "项目加载失败，请稍后重试。";
const TRACE_HEADER_NAMES: readonly string[] = [
  "x-trace-id",
  "x-request-id",
  "trace-id",
  "request-id",
];

export class ProjectRequestError extends Error {
  readonly traceId: string | null;

  constructor(traceId: string | null) {
    super(PROJECT_LOAD_ERROR_MESSAGE);
    this.name = "ProjectRequestError";
    this.traceId = traceId;
  }
}

function normalizeTraceId(value: string | null | undefined): string | null {
  const traceId = value?.trim();
  if (!traceId || traceId.length > 128) return null;
  return /^[A-Za-z0-9._:/-]+$/.test(traceId) ? traceId : null;
}

export function traceIdFromResponse(
  response: Pick<Response, "headers">,
): string | null {
  for (const header of TRACE_HEADER_NAMES) {
    const traceId = normalizeTraceId(response.headers.get(header));
    if (traceId) return traceId;
  }
  return null;
}

function traceIdFromError(error: unknown): string | null {
  return error instanceof ProjectRequestError ? error.traceId : null;
}

export function traceIdFromDetail(detail: string): string | null {
  const match = detail.match(
    /\b(?:trace[_ -]?id|request[_ -]?id)\s*[:=]\s*([A-Za-z0-9._/-]{6,128})/i,
  );
  return normalizeTraceId(match?.[1]);
}

export function withTraceId(message: string, traceId: string | null): string {
  return traceId ? `${message} 追踪 ID：${traceId}` : message;
}

export function ProjectLoadFailure({
  error,
  onRetry,
  className = "",
}: {
  error: unknown;
  onRetry: () => void;
  className?: string;
}) {
  const traceId = traceIdFromError(error);
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-3 px-4 text-center ${className}`}
    >
      <div>
        <p className="text-sm font-medium text-foreground">
          {PROJECT_LOAD_ERROR_MESSAGE}
        </p>
        {traceId && (
          <p className="mt-1 text-xs text-muted-foreground">
            追踪 ID：<code>{traceId}</code>
          </p>
        )}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        <RefreshCwIcon className="size-3.5" />
        重试
      </Button>
    </div>
  );
}
