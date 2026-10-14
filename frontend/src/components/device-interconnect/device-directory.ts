import { useCallback, useSyncExternalStore } from "react";

import { EchoAPIError } from "@/core/api/client";

import { fetchDeviceLinkStatus } from "./device-link";
import { fetchNearbyDevices, type NearbyDevice } from "./nearby-devices";

type Status = Awaited<ReturnType<typeof fetchDeviceLinkStatus>>;
/**
 * Whether this account may use the device control plane. ``signin`` (401)
 * and ``forbidden`` (403) will not change by polling again, so the
 * directory stops polling until the user refreshes or signs in again.
 */
export type DeviceAccess = "ok" | "signin" | "forbidden";
type Snapshot = {
  status: Status | null;
  error: string;
  access: DeviceAccess;
  loading: boolean;
  nearby: NearbyDevice[];
};
const POLL_MS = 5000;
const empty: Snapshot = {
  status: null,
  error: "",
  access: "ok",
  loading: true,
  nearby: [],
};
let snapshot = empty;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let pending: Promise<void> | undefined;
let generation = 0;
const emit = () => listeners.forEach((listener) => listener());

function startPolling() {
  if (timer !== undefined || !listeners.size) return;
  timer = setInterval(() => void refreshDeviceDirectory(), POLL_MS);
}

function stopPolling() {
  clearInterval(timer);
  timer = undefined;
}

function accessFromError(error: unknown): DeviceAccess {
  if (!(error instanceof EchoAPIError)) return "ok";
  if (error.status === 401) return "signin";
  if (error.status === 403) return "forbidden";
  return "ok";
}

export function publishDeviceStatus(status: Status) {
  generation++;
  pending = undefined;
  snapshot = { ...snapshot, status, error: "", access: "ok", loading: false };
  startPolling();
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
      const access = accessFromError(error);
      if (access !== "ok") stopPolling();
      snapshot = {
        status: null,
        nearby: [],
        loading: false,
        access,
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
        startPolling();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          stopPolling();
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
