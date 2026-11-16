/** Provider quota is not transient throttling. Never infer a reset time. */
export function isQuotaExhausted(signal: string): boolean {
  return /usageLimitExceeded|usage_limit_exceeded|insufficient_quota|quota[_ ](?:exceeded|exhausted)|(?:hit|reached|exceeded) your usage limit|usage limit quota reached|额度(?:已)?(?:耗尽|用完)|用量(?:已)?(?:达到|达).*(?:上限)/i.test(signal);
}

export function providerResetTime(detail: string): {value: string; timezoneKnown: boolean} | null {
  let record: Record<string, unknown> | null = null;
  try { const v: unknown = JSON.parse(detail); if(v && typeof v === 'object' && !Array.isArray(v)) record=v as Record<string,unknown>; } catch { /* Plain provider text. */ }
  const value = record?.resetsAt ?? record?.resets_at ?? record?.reset_at;
  if(typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const d=new Date(value < 1e12 ? value*1000 : value);
    if(!Number.isNaN(d.getTime())) return {value:d.toISOString(),timezoneKnown:true};
  }
  const message=typeof record?.message === 'string' ? record.message : detail;
  const raw=typeof value === 'string' ? value : message.match(/try again at\s+([^\r\n]+?)(?:\.\s|\."|\.$|$)/i)?.[1];
  if(!raw || raw.length>160) return null;
  const date=raw.trim().replace(/["}]+$/, '');
  // Accept date-like values only, not arbitrary provider instructions.
  if(!/\d/.test(date) || !/(?:\d{4}-\d{2}-\d{2}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b)/i.test(date)) return null;
  return {value:date,timezoneKnown:/(?:Z|[+-]\d{2}:?\d{2}|\bUTC|\bGMT)\b/i.test(date)};
}

export function modelLimitMessage(detail: string, quota: boolean, locale: string): string {
  const zh=locale.startsWith('zh');
  const reset=providerResetTime(detail);
  const main=quota
    ? (zh?'当前引擎账号的额度已耗尽。请切换到其他有额度的引擎，或等待额度恢复。':'This engine account has exhausted its quota. Switch to another engine with available quota or wait for it to reset.')
    : (zh?'当前引擎暂时限制了请求频率，请稍后重试。':'This engine is temporarily rate limited. Please retry later.');
  return main + (reset
    ? (zh?` 服务端恢复时间：${reset.value}`:` Provider reset time: ${reset.value}`)+(reset.timezoneKnown?'':(zh?'（服务端未注明时区）':' (provider did not specify a timezone)'))
    : (zh?' 服务端未提供恢复时间。':' The provider did not supply a reset time.'));
}
