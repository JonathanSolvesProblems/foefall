import { context, reddit, redis } from '@devvit/web/server';
import { TIERS, type TierId } from '../../shared/engine/generator';
import { trialFor } from '../../shared/game';
import { season, today } from './context';

type Flair = { text: string; backgroundColor: string; textColor: 'light' | 'dark' };

/** Post flair colours by difficulty, gentle green through fiendish red, with violet for Sunday's many-paths day. */
const TIER_FLAIR: Record<TierId, Pick<Flair, 'backgroundColor' | 'textColor'>> = {
  new: { backgroundColor: '#8cc98a', textColor: 'dark' },
  crescent: { backgroundColor: '#b5cf73', textColor: 'dark' },
  quarter: { backgroundColor: '#d9b66b', textColor: 'dark' },
  gibbous: { backgroundColor: '#e39a5c', textColor: 'dark' },
  full: { backgroundColor: '#d9694f', textColor: 'light' },
  broken: { backgroundColor: '#a8344b', textColor: 'light' },
  waning: { backgroundColor: '#7c6fc4', textColor: 'light' },
};

export function dayFlair(day: number): Flair {
  const tier = trialFor(season, day).tier;
  return { text: `Daily · ${TIERS[tier].feel}`, ...TIER_FLAIR[tier] };
}

export const PLAYER_FLAIR: Flair = { text: 'Built by a player', backgroundColor: '#3b3352', textColor: 'light' };

/**
 * Flair a post so the subreddit can filter daily trials by difficulty and tell them from player-built ones. The app is a
 * moderator, so free-text flair needs no template. Best effort: a post without flair still plays.
 */
export async function flairPost(postId: string, flair: Flair): Promise<boolean> {
  try {
    await reddit.setPostFlair({ subredditName: context.subredditName, postId: postId as `t3_${string}`, ...flair });
    return true;
  } catch (e) {
    console.warn('post flair failed', e);
    return false;
  }
}

/** A claim is "pending:<ms>" while its post is being made. One older than this was left by a crash and is taken over. */
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

/**
 * Post the trial for a day, once. Returns the post id, existing or new; the id is '' when another caller is posting it
 * at this moment.
 */
export async function postDay(day: number = today(), force = false): Promise<{ id: string; created: boolean }> {
  const claimKey = 'fw:dayposts';
  const existing = await redis.hGet(claimKey, String(day));
  if (existing && !isPending(existing) && !force) return { id: existing, created: false };
  if (!force) {
    const held = await claimPost(claimKey, String(day));
    if (held !== null) return { id: held, created: false };
  }
  const s = trialFor(season, day);
  const tier = TIERS[s.tier];
  const post = await reddit.submitCustomPost({
    subredditName: context.subredditName,
    title: `Foefall #${day} · ${tier.moon} · ${tier.feel}`,
    entry: 'default',
    postData: { day },
    textFallback: {
      text: `Foefall #${day} is a daily tactics puzzle that plays inside this post. If you only see this text, your Reddit app is too old to show it: update the app, or open the post on reddit.com in a browser.`,
    },
  });
  await redis.set(`fw:post:${post.id}`, String(day));
  await redis.hSet(claimKey, { [String(day)]: post.id });
  await flairPost(post.id, dayFlair(day));
  return { id: post.id, created: true };
}
