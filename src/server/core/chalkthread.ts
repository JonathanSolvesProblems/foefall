// Reddit's pattern for posting game results as the player (Devvit docs, "User actions", "Commenting scores"): after an
// explicit tap, by the user, and as a reply to a single stickied comment. The replies stay out of the way of the real
// discussion until someone expands them, and each player can delete their own. This keeps that stickied comment, one
// per post, made by the app the first time it is needed (or when the daily trial goes up).
import { reddit, redis } from '@devvit/web/server';
import { claimPost } from './claims';

/** Post id to the stickied comment its chalk marks reply to. Holds no player data. */
const THREADS = 'fw:chalkthreads';

export const CHALK_THREAD_TEXT =
  'Chalk marks go here. Clear the trial in the post, then tap Leave a chalk mark to add your result as a reply. The way you won stays secret.';

export async function chalkThread(postId: string): Promise<string | null> {
  const known = await redis.hGet(THREADS, postId);
  if (known?.startsWith('t1_')) return known;
  const held = await claimPost(THREADS, postId);
  if (held !== null) {
    if (held.startsWith('t1_')) return held;
    // Another request is making it right now; give it a moment rather than making a second one.
    await new Promise((r) => setTimeout(r, 1500));
    const now = await redis.hGet(THREADS, postId);
    return now?.startsWith('t1_') ? now : null;
  }
  try {
    const c = await reddit.submitComment({ id: postId as `t3_${string}`, text: CHALK_THREAD_TEXT });
    await c.distinguish(true);
    await redis.hSet(THREADS, { [postId]: c.id });
    return c.id;
  } catch (e) {
    await redis.hDel(THREADS, [postId]);
    console.error('chalk thread failed', e);
    return null;
  }
}

export async function forgetChalkThread(postId: string): Promise<void> {
  await redis.hDel(THREADS, [postId]);
}
