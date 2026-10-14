function formatReplayDuration(durationMs: number): string {
  const roundedSeconds = Math.round(durationMs / 1000);
  if (roundedSeconds < 60) return `${(durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return `${minutes}m${seconds}s`;
}

export function formatProcessReplayLabel({
  title,
  itemCount,
  durationMs,
}: {
  title: string;
  itemCount: string;
  durationMs: number | null;
}): string {
  const duration =
    durationMs === null ? "" : ` · ${formatReplayDuration(durationMs)}`;
  return `${title}${duration} · ${itemCount}`;
}
