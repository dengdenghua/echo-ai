/**
 * Key-field guards for the response bodies read in ``./api``. The
 * OpenAPI snapshot declares those routes as plain dicts, so the module
 * narrows them through ``looseBody`` (see ``@/core/api/response``).
 */
import { isRecord, isString, isUnknownArray } from "@/core/utils/guards";
import type { ChannelsDetailResponse } from "./api";

export function isChannelsDetailResponse(
  value: unknown,
): value is ChannelsDetailResponse {
  return isRecord(value) && isUnknownArray(value.channels);
}

export function hasQrcode(
  value: unknown,
): value is { qrcode?: string; qrcode_img_content?: string } {
  return isRecord(value);
}

export function hasPending(
  value: unknown,
): value is { pending?: Record<string, unknown>[] } {
  return isRecord(value);
}

export function hasMessage(value: unknown): value is { message: string } {
  return isRecord(value) && isString(value.message);
}
