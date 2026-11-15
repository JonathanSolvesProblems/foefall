import { context, reddit, redis } from '@devvit/web/server';
import { TIERS } from '../../shared/engine/generator';
import { trialFor } from '../../shared/game';
import { season, today } from './context';

/**
 * Post the trial for a day, once. A Redis claim keeps the scheduler, the install trigger and the mod menu from posting
 * the same day twice. Returns the post id, existing or new.
 */
export async function postDay(day: number = today(), force = false): Promise<{ id: string; created: boolean }> {
  const claimKey = 'fw:dayposts';
  const existing = await redis.hGet(claimKey, String(day));
  if (existing && existing !== 'pending' && !force) return { id: existing, created: false };
  if (!force && (await redis.hSetNX(claimKey, String(day), 'pending')) === 0) {
    const now = await redis.hGet(claimKey, String(day));
    if (now && now !== 'pending') return { id: now, created: false };
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
  return { id: post.id, created: true };
}
