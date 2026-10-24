/** Local-calendar day helpers (avoid UTC bucketing for Trend). */

/** YYYY-MM-DD in the host's local timezone. */
export function dayKeyLocal(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Inclusive list of local calendar days from startMs through endMs.
 * Uses date arithmetic so DST transitions do not skip/duplicate days.
 */
export function eachLocalDayKeys(startMs: number, endMs: number): string[] {
  const keys: string[] = [];
  const cur = new Date(startMs);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(endMs);
  end.setHours(0, 0, 0, 0);
  while (cur.getTime() <= end.getTime()) {
    keys.push(dayKeyLocal(cur.getTime()));
    cur.setDate(cur.getDate() + 1);
  }
  return keys;
}
