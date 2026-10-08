/** Keep provider diagnostics out of the ordinary member conversation. */
export function memberErrorText(error: string): string {
  const timeout = error.match(/^(?:RuntimeError:\s*)?subagent timed out after (\d+(?:\.\d+)?)s$/i);
  if (!timeout) return error;
  const minutes = Math.max(1, Math.round(Number(timeout[1]) / 60));
  return `执行超过 ${minutes} 分钟，已停止本次任务。尚未收到可交付结果，其他成员可继续工作。`;
}
