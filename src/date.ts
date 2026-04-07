/**
 * Extract the date key ("YYYY-MM-DD") from a Unix epoch timestamp,
 * adjusted to the given timezone offset.
 * Returns null for non-finite timestamps.
 */
export function extractDateKey(epochSeconds: number, tzOffsetMinutes: number): string | null {
  if (!Number.isFinite(epochSeconds)) return null;
  const localMs = (epochSeconds + tzOffsetMinutes * 60) * 1000;
  return new Date(localMs).toISOString().slice(0, 10);
}
