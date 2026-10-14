/**
 * Key-field guards for the response bodies read in ``./api``. The
 * OpenAPI snapshot declares those routes as plain dicts, so the module
 * narrows them through ``looseBody`` (see ``@/core/api/response``).
 */
import {
  arrayOf,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  isUnknownArray,
} from "@/core/utils/guards";
import type {
  DeviceHealth,
  DeviceLease,
  DeviceProcedure,
  PcScreenStats,
  ScreenAnalysis,
  SimulationReport,
  TaskRecord,
  TentacleDevice,
  TentacleStats,
} from "./api";

export function isTentacleDevice(value: unknown): value is TentacleDevice {
  return (
    isRecord(value) &&
    isString(value.tentacle_id) &&
    isUnknownArray(value.capabilities) &&
    isString(value.type)
  );
}

export const isTentacleDeviceList = arrayOf(isTentacleDevice);

export function isDeviceLease(value: unknown): value is DeviceLease {
  return isRecord(value) && isBoolean(value.leased);
}

export function isDeviceHealth(value: unknown): value is DeviceHealth {
  return (
    isRecord(value) &&
    isString(value.device_id) &&
    isUnknownArray(value.reasons) &&
    isString(value.level)
  );
}

export function hasSamples(value: unknown): value is {
  samples: Array<Record<string, unknown>>;
  faults: Array<Record<string, unknown>>;
} {
  return (
    isRecord(value) &&
    isUnknownArray(value.samples) &&
    isUnknownArray(value.faults)
  );
}

export function isDeviceProcedure(value: unknown): value is DeviceProcedure {
  return (
    isRecord(value) &&
    isString(value.procedure_id) &&
    isString(value.device_id) &&
    isUnknownArray(value.steps)
  );
}

export const isDeviceProcedureList = arrayOf(isDeviceProcedure);

export function isSimulationReport(value: unknown): value is SimulationReport {
  return (
    isRecord(value) &&
    isString(value.procedure_id) &&
    isString(value.device_id) &&
    isUnknownArray(value.errors)
  );
}

export function isTaskRecord(value: unknown): value is TaskRecord {
  return (
    isRecord(value) &&
    isString(value.task_id) &&
    isString(value.tentacle_id) &&
    isUnknownArray(value.results)
  );
}

export const isTaskRecordList = arrayOf(isTaskRecord);

export function isTentacleStats(value: unknown): value is TentacleStats {
  return (
    isRecord(value) && isRecord(value.pool) && isNumber(value.ws_connected)
  );
}

export function isScreenAnalysis(value: unknown): value is ScreenAnalysis {
  return (
    isRecord(value) &&
    isUnknownArray(value.suggested_actions) &&
    isString(value.description) &&
    isString(value.screen_state)
  );
}

export function hasScreenStats(
  value: unknown,
): value is { status: string; stats: PcScreenStats } {
  return isRecord(value) && isString(value.status) && isRecord(value.stats);
}

export function hasLastScreenStats(
  value: unknown,
): value is { status: string; last_stats: PcScreenStats } {
  return (
    isRecord(value) && isString(value.status) && isRecord(value.last_stats)
  );
}

export function isPcScreenStats(value: unknown): value is PcScreenStats {
  return (
    isRecord(value) &&
    isBoolean(value.running) &&
    isNumber(value.frame_count) &&
    isNumber(value.last_frame_ts)
  );
}

export function hasSuccess(
  value: unknown,
): value is { success: boolean; error: string | null } {
  return isRecord(value) && isBoolean(value.success);
}
