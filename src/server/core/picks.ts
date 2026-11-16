import { context, reddit, redis } from '@devvit/web/server';
import { loadForge } from '../../shared/game';
import { choosePick, isSunday, PICK_MIN_SCORE, PICK_WINDOW_MS, pickTitle, type PickCandidate } from '../../shared/picks';
import { kv } from './context';
import { flairPost } from './post';

/** Player-built posts by creation time. Trimmed to 30 days, inside the data retention window. */
const FORGE_POSTS = 'fw:forgeposts';
/** Forge id to the post that featured it, so no trial is picked twice. */
const PICKED = 'fw:picked';
/** Day to its community pick post, so the scheduler posts at most one per Sunday. */
const PICK_POSTS = 'fw:pickposts';
const KEEP_MS = 30 * 86_400_000;

export const PICK_FLAIR = { text: 'Community pick', backgroundColor: '#e8c77e', textColor: 'dark' as const };

export async function recordForgePost(postId: string, createdMs = Date.now()): Promise<void> {
  await redis.zAdd(FORGE_POSTS, { member: postId, score: createdMs });
}

export async function forgetForgePost(postId: string): Promise<void> {
  await redis.zRem(FORGE_POSTS, [postId]);
}

/** This week's player-built posts with their Reddit scores. A post that cannot be read (deleted) is left out. */
export async function pickCandidates(nowMs = Date.now()): Promise<PickCandidate[]> {
  await redis.zRemRangeByScore(FORGE_POSTS, 0, nowMs - KEEP_MS);
  const rows = await redis.zRange(FORGE_POSTS, nowMs - PICK_WINDOW_MS, nowMs, { by: 'score' });
  const out: PickCandidate[] = [];
  for (const row of rows) {
    const forgeId = Number((await redis.get(`fw:post:${row.member}`))?.replace(/^forge:/, ''));
    if (!forgeId) continue;
    const forge = await loadForge(kv, forgeId);
    if (!forge) continue;
    try {
      const p = await reddit.getPostById(row.member as `t3_${string}`);
      out.push({ postId: row.member, forgeId, score: p.score, removed: p.removed || p.spam, ways: forge.wayKeys.length, createdMs: row.score });
    } catch {
      /* deleted or unreadable: not a candidate */
    }
  }
  return out;
}

export type PickResult = { id?: string; forgeId?: number; reason: string };

/**
 * Post the week's community pick on a Sunday (or now, with `force`, from the mod menu). `dryRun` chooses without
 * posting, which the self-check uses to prove the Reddit reads work before the first Sunday comes round.
 */
export async function postCommunityPick(day: number, opts: { force?: boolean; dryRun?: boolean } = {}): Promise<PickResult> {
  if (!opts.force && !isSunday(day)) return { reason: 'not Sunday' };
  const existing = await redis.hGet(PICK_POSTS, String(day));
  if (existing && existing !== 'pending' && !opts.force) return { id: existing, reason: 'already posted' };
  const picked = new Set(Object.keys(await redis.hGetAll(PICKED)).map(Number));
  const candidates = await pickCandidates();
  const pick = choosePick(candidates, picked);
  if (!pick) return { reason: `no pick: ${candidates.length} player trials this week, none new with ${PICK_MIN_SCORE}+ points` };
  if (opts.dryRun) return { forgeId: pick.forgeId, reason: `would pick trial ${pick.forgeId} (${pick.score} points of ${candidates.length} candidates)` };
  if (!opts.force && (await redis.hSetNX(PICK_POSTS, String(day), 'pending')) === 0) return { reason: 'already claimed' };
  const forge = await loadForge(kv, pick.forgeId);
  if (!forge) return { reason: `trial ${pick.forgeId} is gone` };
  const post = await reddit.submitCustomPost({
    subredditName: context.subredditName,
    title: pickTitle(forge),
    entry: 'default',
    postData: { forge: forge.id, pick: true },
    textFallback: {
      text: `This week's community pick: a Foefall trial built by u/${forge.author}. It plays inside this post. If you only see this text, update the Reddit app or open the post on reddit.com in a browser.`,
    },
  });
  await redis.set(`fw:post:${post.id}`, `forge:${forge.id}`);
  await redis.hSet(PICK_POSTS, { [String(day)]: post.id });
  await redis.hSet(PICKED, { [String(forge.id)]: post.id });
  await flairPost(post.id, PICK_FLAIR);
  return { id: post.id, forgeId: forge.id, reason: 'posted' };
}
