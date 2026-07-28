export interface QuietHours {
  readonly start: string;
  readonly end: string;
  readonly timezone: string;
}
export type QuietHoursDecision =
  { readonly ok: true; readonly quiet: boolean } | { readonly ok: false; readonly reason: string };
const minutes = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
};
export function evaluateQuietHours(
  now: Date,
  policy: QuietHours,
  priority: 'low' | 'normal' | 'high' | 'critical',
  criticalOverride: boolean,
): QuietHoursDecision {
  const start = minutes(policy.start);
  const end = minutes(policy.end);
  if (start === null || end === null) return { ok: false, reason: 'Invalid quiet-hours interval.' };
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: policy.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);
    if (!Number.isInteger(hour) || !Number.isInteger(minute))
      return { ok: false, reason: 'Unable to resolve timezone.' };
    if (priority === 'critical' && criticalOverride) return { ok: true, quiet: false };
    const current = hour * 60 + minute;
    const quiet =
      start <= end ? current >= start && current < end : current >= start || current < end;
    return { ok: true, quiet };
  } catch {
    return { ok: false, reason: 'Unknown timezone; notification denied.' };
  }
}
