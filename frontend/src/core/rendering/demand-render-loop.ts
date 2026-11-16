export interface DemandRenderLoop {
  /** Render on the next animation frame even while paused. */
  invalidate(): void;
  /** Continuous frames only while a timeline is actually playing. */
  setPlaying(playing: boolean): void;
  /** Hidden/off-screen hosts stop scheduling work entirely. */
  setActive(active: boolean): void;
  dispose(): void;
}

/** Pause rendering when the document is hidden or the stage scrolls away. */
export function bindRenderActivity(
  host: HTMLElement,
  onChange: (active: boolean) => void,
): () => void {
  let inView = true;
  const sync = () => onChange(!document.hidden && inView);
  const observer =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
          inView = entry?.isIntersecting ?? true;
          sync();
        });
  observer?.observe(host);
  document.addEventListener("visibilitychange", sync);
  sync();
  return () => {
    observer?.disconnect();
    document.removeEventListener("visibilitychange", sync);
  };
}

export function createDemandRenderLoop(
  render: (now: number) => void,
): DemandRenderLoop {
  let frame: number | null = null;
  let active = true;
  let playing = false;
  let disposed = false;

  const cancel = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };

  const schedule = () => {
    if (disposed || !active || frame !== null) return;
    frame = requestAnimationFrame(tick);
  };

  const tick = (now: number) => {
    frame = null;
    if (disposed || !active) return;
    render(now);
    if (playing) schedule();
  };

  return {
    invalidate: schedule,
    setPlaying(next) {
      playing = next;
      if (next) schedule();
    },
    setActive(next) {
      active = next;
      if (next) schedule();
      else cancel();
    },
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
