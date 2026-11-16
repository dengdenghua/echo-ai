import {it,expect} from 'vitest';
import {isQuotaExhausted,providerResetTime,modelLimitMessage} from './model-limit';
it('distinguishes quota from transient 429',()=>{
 expect(isQuotaExhausted('http_429 insufficient_quota')).toBe(true);
 expect(isQuotaExhausted('{"codexErrorInfo":"usageLimitExceeded"}')).toBe(true);
 expect(isQuotaExhausted('http_429 rate limit exceeded')).toBe(false);
});
it('preserves upstream date without inventing timezone',()=>{
 const detail=JSON.stringify({message:'Please try again at Nov 14th, 2026 8:33 AM.'});
 expect(providerResetTime(detail)).toEqual({value:'Nov 14th, 2026 8:33 AM',timezoneKnown:false});
 expect(modelLimitMessage(detail,true,'zh-CN')).toContain('服务端未注明时区');
});
it('formats explicit epoch as UTC',()=>{
 expect(providerResetTime('{"resets_at":1794616380}')?.value).toBe(new Date(1794616380000).toISOString());
});
it('does not invent missing reset dates',()=>{
 expect(providerResetTime('http_429')).toBeNull();
 expect(providerResetTime('{"resets_at":"tomorrow"}')).toBeNull();
 expect(modelLimitMessage('usageLimitExceeded',true,'zh-CN')).toContain('未提供恢复时间');
});
