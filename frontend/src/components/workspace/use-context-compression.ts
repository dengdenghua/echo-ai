import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/core/i18n/hooks";
import type { ContextCompressorProps } from "./context-compressor";

/** Keep compression active even while its settings panel is closed. */
export function useContextCompression({
  sessionId,
  currentTokens,
  maxTokens,
  compressThreshold = 0.9,
  isCompressing = false,
  onCompress,
  disabled = false,
}: ContextCompressorProps) {
  const { locale } = useI18n();
  const failedMessage = locale.startsWith("zh")
    ? "压缩失败，请重试"
    : "Compression failed. Try again";
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAutoCompressed, setHasAutoCompressed] = useState(false);
  const autoCompressRef = useRef(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const known = Number.isFinite(maxTokens) && maxTokens > 0;
  const used = Number.isFinite(currentTokens) ? Math.max(0, currentTokens) : 0;
  const progress = known ? Math.min(used / maxTokens, 1) : 0;
  const percentage = Math.round(progress * 100);
  const busy = requesting || isCompressing;
  const canCompress = known && used > 0 && !!onCompress && !disabled && !busy;

  useEffect(() => {
    generation.current += 1;
    autoCompressRef.current = false;
    inFlight.current = false;
    setHasAutoCompressed(false);
    setRequesting(false);
    setError(null);
    return () => {
      generation.current += 1;
    };
  }, [sessionId]);

  const requestCompress = useCallback(
    async (automatic = false) => {
      if (!canCompress || inFlight.current || !onCompress) return;
      const epoch = generation.current;
      inFlight.current = true;
      setRequesting(true);
      setError(null);
      try {
        await onCompress();
        if (epoch === generation.current && automatic)
          setHasAutoCompressed(true);
      } catch (reason) {
        if (epoch === generation.current)
          setError(reason instanceof Error ? reason.message : failedMessage);
      } finally {
        if (epoch === generation.current) {
          inFlight.current = false;
          setRequesting(false);
        }
      }
    },
    [canCompress, onCompress, failedMessage],
  );

  useEffect(() => {
    if (progress < compressThreshold * 0.8) {
      autoCompressRef.current = false;
      setHasAutoCompressed(false);
    } else if (
      progress >= compressThreshold &&
      canCompress &&
      !autoCompressRef.current
    ) {
      autoCompressRef.current = true;
      void requestCompress(true);
    }
  }, [sessionId, progress, compressThreshold, canCompress, requestCompress]);

  return {
    known,
    used,
    progress,
    percentage,
    busy,
    canCompress,
    hasAutoCompressed,
    error,
    requestCompress,
  };
}

export type ContextCompressionState = ReturnType<typeof useContextCompression>;
