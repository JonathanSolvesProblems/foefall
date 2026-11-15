const DAY_MS = 86_400_000;
const POST_OFFSET_MS = 60_000; // the scheduler posts at 00:01 UTC

/** Time until the scheduler posts the next trial (00:01 UTC), as "5 h 12 min" or "12 min". */
export function untilNextTrial(nowMs = Date.now()): string {
  const next = Math.floor((nowMs - POST_OFFSET_MS) / DAY_MS) * DAY_MS + DAY_MS + POST_OFFSET_MS;
  const mins = Math.max(1, Math.ceil((next - nowMs) / 60_000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h} h ${mins % 60} min` : `${mins} min`;
}
