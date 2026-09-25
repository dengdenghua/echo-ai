import { useCallback, useSyncExternalStore } from "react";
import { fetchDeviceLinkStatus } from "./device-link";
import { fetchNearbyDevices, type NearbyDevice } from "./nearby-devices";

type Status = Awaited<ReturnType<typeof fetchDeviceLinkStatus>>;
type Snapshot = {
  status: Status | null;
  error: string;
  loading: boolean;
  nearby: NearbyDevice[];
};
const empty: Snapshot = { status: null, error: "", loading: true, nearby: [] };
let snapshot = empty;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let pending: Promise<void> | undefined;
let generation = 0;
const emit = () => listeners.forEach((listener) => listener());

export function publishDeviceStatus(status: Status) {
  generation++;
  pending = undefined;
  snapshot = { ...snapshot, status, error: "", loading: false };
  emit();
}

export function refreshDeviceDirectory(): Promise<void> {
  if (pending) return pending;
  const version = generation;
  const request = Promise.all([
    fetchDeviceLinkStatus(),
    fetchNearbyDevices().catch(() => []),
  ])
    .then(([status, nearby]) => {
      if (version === generation) {
        snapshot = { ...snapshot, nearby };
        publishDeviceStatus(status);
      }
    })
    .catch((error: unknown) => {
      if (version !== generation) return;
      // Never leave cached devices looking online after authentication/network failure.
      snapshot = {
        status: null,
        nearby: [],
        loading: false,
        error: error instanceof Error ? error.message : "无法读取设备",
      };
      emit();
    })
    .finally(() => {
      if (pending === request) pending = undefined;
    });
  pending = request;
  return request;
}

export function useDeviceDirectory(enabled = true) {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!enabled) return () => {};
      listeners.add(listener);
      if (listeners.size === 1) {
        void refreshDeviceDirectory();
        timer = setInterval(() => void refreshDeviceDirectory(), 5000);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          clearInterval(timer);
          generation++;
          pending = undefined;
          snapshot = empty;
        }
      };
    },
    [enabled],
  );
  return useSyncExternalStore(
    subscribe,
    () => (enabled ? snapshot : empty),
    () => empty,
  );
}
