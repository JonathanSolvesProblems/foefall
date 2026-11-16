// Claims that stop overlapping callers (the scheduler, triggers, the mod menu, two players at once) from making the same
// post or comment twice. A claim is "pending:<ms>" while its owner works; one left behind by a crash goes stale.
import { redis } from '@devvit/web/server';

const CLAIM_STALE_MS = 120_000;
export const isPending = (v: string | undefined): boolean => !!v && v.startsWith('pending');
const isFreshClaim = (v: string, nowMs: number) => nowMs - Number(v.split(':')[1] ?? 0) < CLAIM_STALE_MS;

/**
 * Claim a field before posting, so the scheduler, the triggers and the mod menu never post the same thing twice even
 * when they overlap. Returns the existing post id, '' when another caller is posting it right now, or null when the
 * caller holds the claim and should post.
 */
export async function claimPost(key: string, field: string, nowMs = Date.now()): Promise<string | null> {
  if ((await redis.hSetNX(key, field, `pending:${nowMs}`)) === 1) return null;
  const cur = await redis.hGet(key, field);
  if (cur && !isPending(cur)) return cur;
  if (cur && isFreshClaim(cur, nowMs)) return '';
  await redis.hSet(key, { [field]: `pending:${nowMs}` });
  return null;
}
