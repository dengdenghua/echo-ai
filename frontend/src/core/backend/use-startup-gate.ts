import { useEffect, useState } from "react";

const POLL_MS = 1500;
const PROBE_TIMEOUT_MS = 2000;
const SHOW_DELAY_MS = 400;

/** A one-way startup gate. Later outages belong to the connection UI. */
export function useStartupGate(enabled: boolean) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [delayElapsed, setDelayElapsed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let nextProbe: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const delay = setTimeout(() => {
      if (active) setDelayElapsed(true);
    }, SHOW_DELAY_MS);

    const check = async () => {
      let ok = false;
      try {
        const response = await fetch("/readyz", {
          method: "GET",
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(PROBE_TIMEOUT_MS),
          ]),
        });
        ok = response.ok;
      } catch {
        // The service may still be starting; retry without overlapping probes.
      }
      if (!active) return;
      setReady(ok);
      if (ok) clearTimeout(delay);
      else nextProbe = setTimeout(() => void check(), POLL_MS);
    };
    void check();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(delay);
      clearTimeout(nextProbe);
    };
  }, [enabled]);

  return enabled && ready === false && delayElapsed;
}
