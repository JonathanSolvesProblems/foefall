import { context, reddit, redis } from '@devvit/web/server';
import { dayNumber } from '../../shared/engine/generator';
import { type ForgedTrial, type KV, loadForge, type SeasonDay, type Who } from '../../shared/game';
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
  get: (k) => redis.get(k),
  set: (k, v) => redis.set(k, v),
  incrBy: (k, by) => redis.incrBy(k, by),
};

export const today = () => dayNumber(Date.now());

/** What this post holds: a forged trial (post data `forge`), or a day's trial. */
export async function trialForPost(): Promise<{ day: number; forge: ForgedTrial | undefined }> {
  const forgeId = context.postData?.forge;
  if (typeof forgeId === 'number' && forgeId > 0) {
    const forge = (await loadForge(kv, forgeId)) ?? undefined;
    if (forge) return { day: -forgeId, forge };
  }
  return { day: await dayForPost(), forge: undefined };
}

/** The day this post belongs to: from its post data, then from Redis, then today's. */
export async function dayForPost(): Promise<number> {
  const fromData = context.postData?.day;
  if (typeof fromData === 'number' && fromData > 0) return fromData;
  if (context.postId) {
    const stored = await redis.get(`fw:post:${context.postId}`);
    const n = stored ? Number(stored) : NaN;
    if (Number.isInteger(n) && n > 0) return n;
  }
  return today();
}

export async function currentWho(): Promise<Who> {
  const userId = context.userId;
  if (!userId) return { userId: undefined, username: undefined, avatar: undefined };
  const username = context.username ?? (await reddit.getCurrentUsername()) ?? undefined;
  return { userId, username, avatar: context.snoovatar ?? undefined };
}
