export function normalizeEmailVerificationCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

export function remainingCooldownSeconds(deadline: number, now = Date.now()) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** fetch() rejects with a TypeError ("Failed to fetch") when the service is unreachable. */
export const SERVICE_UNREACHABLE_MESSAGE =
  "暂时无法连接 Echo 服务，请确认服务已启动后重试。";

export function loginErrorMessage(error: unknown, describe: (error: unknown) => string): string {
  return error instanceof TypeError ? SERVICE_UNREACHABLE_MESSAGE : describe(error);
}
