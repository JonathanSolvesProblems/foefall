// Game state over a small key-value interface. The Devvit server passes its Redis client; tests and the local preview pass
// an in-memory one, so the same code is what runs on Reddit.

import type { AttemptResponse, BoardRow, Community, FoundWay, InitResponse, Me, Nation } from './api';
import { NATION_LIST } from './api';
import { EPOCH_UTC, TIERS, type TierId } from './engine/generator';
import { type Action, playTurn, type Puzzle } from './engine/rules';

export type SeasonDay = { day: number; date: string; tier: TierId; puzzle: Puzzle; wayKeys: string[]; winRatio: number };

export type KV = {
  hGet(key: string, field: string): Promise<string | undefined>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hSet(key: string, values: Record<string, string>): Promise<unknown>;
  hSetNX(key: string, field: string, value: string): Promise<number>;
  hDel(key: string, fields: string[]): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  hIncrBy(key: string, field: string, by: number): Promise<number>;
  zAdd(key: string, ...members: { member: string; score: number }[]): Promise<unknown>;
  zRange(key: string, start: number, stop: number, options?: { by: 'rank' }): Promise<{ member: string; score: number }[]>;
  expire(key: string, seconds: number): Promise<unknown>;
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<unknown>;
  incrBy(key: string, by: number): Promise<number>;
};

/** A trial a redditor built and posted. Its play data lives under the pseudo day -id, so it never touches streaks. */
export type ForgedTrial = { id: number; title: string; author: string; puzzle: Puzzle; wayKeys: string[]; created?: number | undefined };

/**
 * Devvit Rules ask apps to remove a deleted account's data, and recommend deleting stored user data within 30 days.
 * There is no account-deletion trigger, so every key that holds a username, user id or avatar expires 30 days after its
 * last write. A player's own record renews while they keep playing.
 */
export const RETENTION_SECONDS = 30 * 24 * 60 * 60;

/**
 * Seconds until a trial's shared records expire: its ways and their first finders, the board of first clears and the
 * tallies. They hold other players' names, so the clock starts when the trial did (midnight UTC on its day, or when a
 * redditor posted it) and later play never extends it. A write after that keeps its data for an hour, enough to show it.
 */
export function trialTtl(day: number, nowMs: number, forgeCreatedMs?: number): number {
  const start = day > 0 ? EPOCH_UTC + (day - 1) * 86_400_000 : (forgeCreatedMs ?? nowMs);
  return Math.max(3600, Math.floor((start + RETENTION_SECONDS * 1000 - nowMs) / 1000));
}

export type Who = { userId: string | undefined; username: string | undefined; avatar: string | undefined };

const K = {
  user: (u: string) => `fw:u:${u}`,
  dayUser: (d: number, u: string) => `fw:d${d}:u:${u}`,
  stats: (d: number) => `fw:d${d}:stats`,
  ways: (d: number) => `fw:d${d}:ways`,
  wayCount: (d: number) => `fw:d${d}:waycount`,
  nations: (d: number) => `fw:d${d}:nations`,
  board: (d: number) => `fw:d${d}:board`,
  boardInfo: (d: number) => `fw:d${d}:boardinfo`,
};

/** The trial for a day. Past the end of the season it wraps, so the subreddit is never without a trial. */
export function trialFor(season: readonly SeasonDay[], day: number): SeasonDay {
  const n = season.length;
  const i = (((day - 1) % n) + n) % n;
  const s = season[i];
  if (!s) throw new Error('empty season');
  return s;
}

const num = (v: string | undefined) => (v ? Number(v) || 0 : 0);

function parseWays(v: string | undefined): string[] {
  if (!v) return [];
  try {
    const x: unknown = JSON.parse(v);
    return Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

const isNation = (v: string | undefined): v is Nation => !!v && (NATION_LIST as readonly string[]).includes(v);

async function loadMe(kv: KV, day: number, today: number, who: Who, postId?: string): Promise<Me> {
  if (!who.userId) {
    return { username: null, tries: 0, solved: false, ways: [], streak: 0, best: 0, nation: null, firstVisit: true, chalked: 0, clearTry: 0 };
  }
  const [u, du] = await Promise.all([kv.hGetAll(K.user(who.userId)), kv.hGetAll(K.dayUser(day, who.userId))]);
  const last = num(u.last);
  const alive = last === today || last === today - 1;
  return {
    username: who.username ?? null,
    tries: num(du.tries),
    solved: du.solved === '1',
    ways: parseWays(du.ways),
    streak: alive ? num(u.streak) : 0,
    best: num(u.best),
    nation: isNation(u.nation) ? u.nation : null,
    firstVisit: u.seen !== '1',
    chalked: num(du[`chalked:${postId ?? ''}`]),
    clearTry: num(du.clearTry),
  };
}

/**
 * Claim a chalk mark before posting it. One per player per post, plus one more each time they find another way, so a
 * thread never carries the same result twice; a trial posted again (a community pick) has its own thread. The claim is
 * atomic, so two taps or two tabs cannot both post. Release it if the comment fails. The fields live in the player's day
 * record, which expires with it.
 */
export async function claimChalk(kv: KV, day: number, userId: string, postId: string, ways: number): Promise<boolean> {
  const du = K.dayUser(day, userId);
  const won = (await kv.hSetNX(du, `chalk:${postId}:${ways}`, '1')) === 1;
  if (won) {
    await kv.hSet(du, { [`chalked:${postId}`]: String(ways) });
    await kv.expire(du, RETENTION_SECONDS);
  }
  return won;
}

export async function releaseChalk(kv: KV, day: number, userId: string, postId: string, ways: number, before: number): Promise<void> {
  const du = K.dayUser(day, userId);
  await kv.hDel(du, [`chalk:${postId}:${ways}`]);
  await kv.hSet(du, { [`chalked:${postId}`]: String(before) });
}

async function loadCommunity(kv: KV, s: SeasonDay, myWays: string[]): Promise<Community> {
  const day = s.day;
  const [stats, ways, counts, nations, top, info] = await Promise.all([
    kv.hGetAll(K.stats(day)),
    kv.hGetAll(K.ways(day)),
    kv.hGetAll(K.wayCount(day)),
    kv.hGetAll(K.nations(day)),
    kv.zRange(K.board(day), 0, 9, { by: 'rank' }),
    kv.hGetAll(K.boardInfo(day)),
  ]);
  const found: FoundWay[] = Object.entries(ways).map(([key, raw]) => {
    let finder = 'someone';
    let finderAvatar: string | null = null;
    try {
      const v = JSON.parse(raw) as { finder?: string; avatar?: string | null };
      finder = v.finder ?? finder;
      finderAvatar = v.avatar ?? null;
    } catch {
      /* keep defaults */
    }
    return { key, finder, finderAvatar, count: num(counts[key]), mine: myWays.includes(key) };
  });
  // Show ways in the order the subreddit found them is not stored; sort by how many found each, then by key, so the
  // codex is stable between loads.
  found.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const board: BoardRow[] = top.map(({ member, score }) => {
    let avatar: string | null = null;
    let wayN = 1;
    try {
      const v = JSON.parse(info[member] ?? '{}') as { avatar?: string | null; ways?: number };
      avatar = v.avatar ?? null;
      wayN = v.ways ?? 1;
    } catch {
      /* keep defaults */
    }
    return { name: member, avatar, tries: Math.floor(score / 100_000), ways: wayN };
  });
  const nationCounts = Object.fromEntries(NATION_LIST.map((n) => [n, num(nations[n])])) as Record<Nation, number>;
  return {
    players: num(stats.players),
    solvers: num(stats.solvers),
    waysTotal: Math.max(s.wayKeys.length, found.length),
    ways: found,
    nations: nationCounts,
    board,
  };
}

export async function loadInit(
  kv: KV,
  season: readonly SeasonDay[],
  opts: { day: number; today: number; who: Who; subreddit: string; forge?: ForgedTrial | undefined; postId?: string | undefined }
): Promise<InitResponse> {
  const { s, day } = resolveTrial(season, opts.day, opts.forge);
  const me = await loadMe(kv, day, opts.today, opts.who, opts.postId);
  const community = await loadCommunity(kv, { ...s, day }, me.ways);
  const tier = TIERS[s.tier];
  const f = opts.forge;
  return {
    type: 'init',
    day,
    date: s.date,
    tier: s.tier,
    moon: f ? 'Player trial' : tier.moon,
    feel: f ? `${f.wayKeys.length} ${f.wayKeys.length === 1 ? 'way' : 'ways'}` : tier.feel,
    isToday: !f && day === opts.today,
    today: opts.today,
    subreddit: opts.subreddit,
    puzzle: s.puzzle,
    me,
    community,
    forge: f ? { id: f.id, title: f.title, author: f.author } : null,
    todayUrl: null,
  };
}

function resolveTrial(season: readonly SeasonDay[], day: number, forge?: ForgedTrial): { s: SeasonDay; day: number } {
  if (!forge) return { s: trialFor(season, day), day };
  const pseudo = -forge.id;
  return { s: { day: pseudo, date: '', tier: 'quarter', puzzle: forge.puzzle, wayKeys: forge.wayKeys, winRatio: 0 }, day: pseudo };
}

export type AttemptResult = AttemptResponse | { type: 'error'; message: string };

/** Replay the player's turn on the server, then record it. The client's own verdict is never trusted. */
export async function recordAttempt(
  kv: KV,
  season: readonly SeasonDay[],
  opts: { day: number; today: number; who: Who; actions: Action[]; nowMs: number; forge?: ForgedTrial | undefined; postId?: string | undefined }
): Promise<AttemptResult> {
  const resolved = resolveTrial(season, opts.day, opts.forge);
  const s = resolved.s;
  opts = { ...opts, day: resolved.day };
  if (!Array.isArray(opts.actions) || opts.actions.length > s.puzzle.heroes.length) {
    return { type: 'error', message: 'That turn has more actions than heroes.' };
  }
  const played = playTurn(s.puzzle, opts.actions);
  if (!played) return { type: 'error', message: 'That turn is not legal on this board.' };
  const { win, wayKey } = played.outcome;
  const { userId, username, avatar } = opts.who;

  if (!userId || !username) {
    const me = await loadMe(kv, opts.day, opts.today, opts.who, opts.postId);
    const community = await loadCommunity(kv, { ...s, day: opts.day }, []);
    const known = community.ways.some((w) => w.key === wayKey);
    return { type: 'attempt', win, wayKey, newForMe: win, firstFinder: win && !known, saved: false, me, community };
  }

  const day = opts.day;
  const du = K.dayUser(day, userId);
  // The player's own records renew with their play; the trial's shared ones run out on the trial's own clock.
  const shared = trialTtl(day, opts.nowMs, opts.forge?.created);
  const tries = await kv.hIncrBy(du, 'tries', 1);
  if (tries === 1) await kv.hIncrBy(K.stats(day), 'players', 1);
  await kv.expire(du, RETENTION_SECONDS);
  await kv.expire(K.stats(day), shared);

  let newForMe = false;
  let firstFinder = false;
  if (win) {
    const myWays = parseWays(await kv.hGet(du, 'ways'));
    newForMe = !myWays.includes(wayKey);
    if (newForMe) {
      myWays.push(wayKey);
      await kv.hSet(du, { ways: JSON.stringify(myWays) });
      await kv.hIncrBy(K.wayCount(day), wayKey, 1);
      firstFinder = (await kv.hSetNX(K.ways(day), wayKey, JSON.stringify({ finder: username, avatar: avatar ?? null }))) === 1;
    }
    const solvedBefore = (await kv.hGet(du, 'solved')) === '1';
    const u = await kv.hGetAll(K.user(userId));
    if (!solvedBefore) {
      await kv.hSet(du, { solved: '1', clearTry: String(tries) });
      await kv.hIncrBy(K.stats(day), 'solvers', 1);
      const secondsIntoDay = Math.floor((opts.nowMs % 86_400_000) / 1000);
      await kv.zAdd(K.board(day), { member: username, score: tries * 100_000 + secondsIntoDay });
      if (isNation(u.nation)) await kv.hIncrBy(K.nations(day), u.nation, 1);
      // Streaks only move on the day's own trial, played on its day.
      if (day === opts.today) {
        const last = num(u.last);
        if (last !== day) {
          const streak = last === day - 1 ? num(u.streak) + 1 : 1;
          await kv.hSet(K.user(userId), {
            streak: String(streak),
            best: String(Math.max(streak, num(u.best))),
            last: String(day),
            total: String(num(u.total) + 1),
          });
        }
      }
    }
    await kv.hSet(K.boardInfo(day), { [username]: JSON.stringify({ avatar: avatar ?? null, ways: myWays.length }) });
    await kv.expire(K.user(userId), RETENTION_SECONDS);
    const touched = [K.ways(day), K.wayCount(day), K.nations(day), K.board(day), K.boardInfo(day)];
    await Promise.all(touched.map((k) => kv.expire(k, shared)));
  }

  // With the post id, so the win card knows whether this post's chalk mark is already left.
  const me = await loadMe(kv, day, opts.today, opts.who, opts.postId);
  const community = await loadCommunity(kv, { ...s, day }, me.ways);
  return { type: 'attempt', win, wayKey, newForMe, firstFinder, saved: true, me, community };
}

export async function setNation(kv: KV, userId: string, nation: Nation): Promise<void> {
  await kv.hSet(K.user(userId), { nation });
  await kv.expire(K.user(userId), RETENTION_SECONDS);
}

export async function markSeen(kv: KV, userId: string): Promise<void> {
  await kv.hSet(K.user(userId), { seen: '1' });
  await kv.expire(K.user(userId), RETENTION_SECONDS);
}

const FK = {
  seq: 'fw:forge:seq',
  data: (id: number) => `fw:forge:${id}`,
  author: (id: number) => `fw:forge:${id}:author`,
  post: (id: number) => `fw:forge:${id}:post`,
};

/** Store a forged trial and return its id. The author's name expires with other user data; the board stays. */
/**
 * A trial a redditor built is their content: it expires with the retention window like everything else that came from
 * a player, and it is deleted outright when they delete the post it went up in (see forgetForge).
 */
export async function saveForge(kv: KV, f: Omit<ForgedTrial, 'id'>, nowMs = Date.now()): Promise<number> {
  const id = await kv.incrBy(FK.seq, 1);
  await kv.set(FK.data(id), JSON.stringify({ title: f.title, puzzle: f.puzzle, wayKeys: f.wayKeys, created: f.created ?? nowMs }));
  await kv.set(FK.author(id), f.author);
  await Promise.all([FK.data(id), FK.author(id)].map((k) => kv.expire(k, RETENTION_SECONDS)));
  return id;
}

/** Remember which post a trial first went up in, so deleting that post deletes the trial. */
export async function setForgePost(kv: KV, id: number, postId: string): Promise<void> {
  await kv.set(FK.post(id), postId);
  await kv.expire(FK.post(id), RETENTION_SECONDS);
}

/** When its maker deletes the post a trial went up in, delete the trial too. A repost (a community pick) does not. */
export async function forgetForge(kv: KV, id: number, deletedPostId: string): Promise<boolean> {
  if ((await kv.get(FK.post(id))) !== deletedPostId) return false;
  await kv.del(FK.data(id), FK.author(id), FK.post(id));
  return true;
}

export async function loadForge(kv: KV, id: number): Promise<ForgedTrial | null> {
  const raw = await kv.get(FK.data(id));
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { title?: string; puzzle?: Puzzle; wayKeys?: string[]; created?: number };
    if (!v.puzzle || !Array.isArray(v.wayKeys)) return null;
    const author = (await kv.get(FK.author(id))) ?? 'a redditor';
    return { id, title: v.title ?? '', author, puzzle: { ...v.puzzle, id: `f${id}` }, wayKeys: v.wayKeys, created: v.created };
  } catch {
    return null;
  }
}

/** The user flair text: nation sigil and name, then the streak if there is one. Reddit caps flair at 64 characters. */
export function flairText(me: Me, sigil: string, short: string): string {
  const streak = me.streak > 0 ? ` · ${me.streak}-day streak` : '';
  return `${sigil} ${short}${streak}`.slice(0, 64);
}

/** An in-memory KV for tests and the local preview. */
export function memoryKV(): KV & { ttl: Map<string, number> } {
  const h = new Map<string, Map<string, string>>();
  const z = new Map<string, Map<string, number>>();
  const ttl = new Map<string, number>();
  const strs = new Map<string, string>();
  const hash = (k: string) => {
    let m = h.get(k);
    if (!m) h.set(k, (m = new Map()));
    return m;
  };
  return {
    ttl,
    expire: async (k, seconds) => {
      ttl.set(k, seconds);
    },
    get: async (k) => strs.get(k),
    set: async (k, v) => {
      strs.set(k, v);
      return 'OK';
    },
    incrBy: async (k, by) => {
      const n = (Number(strs.get(k)) || 0) + by;
      strs.set(k, String(n));
      return n;
    },
    hGet: async (k, f) => h.get(k)?.get(f),
    hGetAll: async (k) => Object.fromEntries(h.get(k) ?? []),
    hSet: async (k, v) => {
      for (const [f, x] of Object.entries(v)) hash(k).set(f, x);
      return Object.keys(v).length;
    },
    hSetNX: async (k, f, v) => {
      const m = hash(k);
      if (m.has(f)) return 0;
      m.set(f, v);
      return 1;
    },
    hDel: async (k, fs) => {
      for (const f of fs) h.get(k)?.delete(f);
      return fs.length;
    },
    del: async (...ks) => {
      for (const k of ks) {
        h.delete(k);
        z.delete(k);
        strs.delete(k);
        ttl.delete(k);
      }
      return ks.length;
    },
    hIncrBy: async (k, f, by) => {
      const m = hash(k);
      const n = (Number(m.get(f)) || 0) + by;
      m.set(f, String(n));
      return n;
    },
    zAdd: async (k, ...members) => {
      let m = z.get(k);
      if (!m) z.set(k, (m = new Map()));
      for (const { member, score } of members) m.set(member, score);
      return members.length;
    },
    zRange: async (k, start, stop) => {
      const m = z.get(k);
      if (!m) return [];
      return [...m.entries()]
        .map(([member, score]) => ({ member, score }))
        .sort((a, b) => a.score - b.score)
        .slice(start, stop + 1);
    },
  };
}
