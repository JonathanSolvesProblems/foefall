import { context, reddit, redis } from '@devvit/web/server';
import { dayNumber } from '../../shared/engine/generator';
import type { KV, SeasonDay, Who } from '../../shared/game';
import seasonJson from '../season.json';

export const season = seasonJson as SeasonDay[];

/** The Devvit Redis client, narrowed to what the game uses. */
export const kv: KV = {
  hGet: (k, f) => redis.hGet(k, f),
  hGetAll: (k) => redis.hGetAll(k),
  hSet: (k, v) => redis.hSet(k, v),
  hSetNX: (k, f, v) => redis.hSetNX(k, f, v),
  hIncrBy: (k, f, by) => redis.hIncrBy(k, f, by),
  zAdd: (k, ...m) => redis.zAdd(k, ...m),
  zRange: (k, start, stop, options) => redis.zRange(k, start, stop, options ?? { by: 'rank' }),
  expire: (k, seconds) => redis.expire(k, seconds),
};

export const today = () => dayNumber(Date.now());

/** The day this post belongs to: from its post data, then from Redis, then today's. */
export async function dayForPost(): Promise<number> {
  const fromData = context.postData?.day;
  if (typeof fromData === 'number' && fromData > 0) return fromData;
  if (context.postId) {
    const stored = await redis.get(`fw:post:${context.postId}`);
    if (stored) return Number(stored);
  }
  return today();
}

export async function currentWho(): Promise<Who> {
  const userId = context.userId;
  if (!userId) return { userId: undefined, username: undefined, avatar: undefined };
  const username = context.username ?? (await reddit.getCurrentUsername()) ?? undefined;
  return { userId, username, avatar: context.snoovatar ?? undefined };
}
