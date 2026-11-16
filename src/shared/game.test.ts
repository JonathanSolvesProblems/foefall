import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dateOfDay, dayNumber, EPOCH_UTC } from './engine/generator';
import { solve } from './engine/solver';
import {
  claimChalk,
  forgetForge,
  loadForge,
  loadInit,
  markSeen,
  memoryKV,
  recordAttempt,
  releaseChalk,
  RETENTION_SECONDS,
  saveForge,
  type SeasonDay,
  setForgePost,
  setNation,
  trialFor,
  trialTtl,
} from './game';

const season = JSON.parse(readFileSync('src/server/season.json', 'utf8')) as SeasonDay[];

describe('the season', () => {
  it('has a trial for every day from launch through judging and beyond', () => {
    expect(season.length).toBeGreaterThanOrEqual(90);
    season.forEach((s, i) => expect(s.day).toBe(i + 1));
  });

  it.each(season.map((s) => [s.day, s] as const))('day %i can be won, not by doing nothing, in exactly its stated ways', (_d, s) => {
    const res = solve(s.puzzle);
    expect(res.truncated).toBe(false);
    expect(res.trivial).toBe(false);
    expect(res.ways.map((w) => w.key)).toEqual([...s.wayKeys].sort());
  }, 30_000);

  it('maps dates to days in UTC, and wraps past the end of the season', () => {
    expect(dayNumber(EPOCH_UTC)).toBe(1);
    expect(dayNumber(EPOCH_UTC + 86_400_000 * 23 + 5)).toBe(24);
    expect(dateOfDay(1).date).toBe('2026-11-15');
    expect(trialFor(season, season.length + 1).day).toBe(1);
  });
});

const who = (n: string) => ({ userId: `t2_${n}`, username: n, avatar: `https://example.invalid/${n}.png` });
const DAY = 86_400_000;
const dayStart = (d: number) => EPOCH_UTC + (d - 1) * DAY;

async function winningLine(day: number) {
  const s = trialFor(season, day);
  const res = solve(s.puzzle);
  return { s, ways: res.ways };
}

describe('recording attempts', () => {
  it('credits the first finder of a way, counts tries, and starts a streak', async () => {
    const kv = memoryKV();
    const { ways } = await winningLine(4);
    const first = ways[0]!;
    const a = await recordAttempt(kv, season, { day: 4, today: 4, who: who('ana'), actions: first.line, nowMs: 0 });
    expect(a.type).toBe('attempt');
    if (a.type !== 'attempt') return;
    expect(a.win).toBe(true);
    expect(a.firstFinder).toBe(true);
    expect(a.me.streak).toBe(1);
    expect(a.me.tries).toBe(1);
    const b = await recordAttempt(kv, season, { day: 4, today: 4, who: who('ben'), actions: first.line, nowMs: 1000 });
    if (b.type !== 'attempt') throw new Error('expected attempt');
    expect(b.firstFinder).toBe(false);
    expect(b.community.ways.find((w) => w.key === first.key)).toMatchObject({ finder: 'ana', count: 2 });
    expect(b.community.solvers).toBe(2);
    expect(b.community.board.map((r) => r.name)).toEqual(['ana', 'ben']);
  });

  it('a second way the same day adds to my ways but does not double-count the solve', async () => {
    const kv = memoryKV();
    const { ways } = await winningLine(4);
    expect(ways.length).toBeGreaterThan(1);
    await recordAttempt(kv, season, { day: 4, today: 4, who: who('ana'), actions: ways[0]!.line, nowMs: 0 });
    const r = await recordAttempt(kv, season, { day: 4, today: 4, who: who('ana'), actions: ways[1]!.line, nowMs: 0 });
    if (r.type !== 'attempt') throw new Error('expected attempt');
    expect(r.me.ways.length).toBe(2);
    expect(r.community.solvers).toBe(1);
    expect(r.me.tries).toBe(2);
  });

  it('streaks grow on consecutive days and reset after a missed day', async () => {
    const kv = memoryKV();
    for (const day of [5, 6, 7]) {
      const { ways } = await winningLine(day);
      await recordAttempt(kv, season, { day, today: day, who: who('cy'), actions: ways[0]!.line, nowMs: 0 });
    }
    let init = await loadInit(kv, season, { day: 7, today: 7, who: who('cy'), subreddit: 'test' });
    expect(init.me.streak).toBe(3);
    init = await loadInit(kv, season, { day: 9, today: 9, who: who('cy'), subreddit: 'test' });
    expect(init.me.streak).toBe(0);
    expect(init.me.best).toBe(3);
  });

  it('an old post can be won but does not move the streak', async () => {
    const kv = memoryKV();
    const { ways } = await winningLine(3);
    const r = await recordAttempt(kv, season, { day: 3, today: 10, who: who('di'), actions: ways[0]!.line, nowMs: 0 });
    if (r.type !== 'attempt') throw new Error('expected attempt');
    expect(r.win).toBe(true);
    expect(r.me.streak).toBe(0);
  });

  it('refuses an illegal turn and does not count it', async () => {
    const kv = memoryKV();
    const s = trialFor(season, 4);
    const h = s.puzzle.heroes[0]!;
    const r = await recordAttempt(kv, season, {
      day: 4,
      today: 4,
      who: who('ed'),
      actions: [{ hero: h.id, to: [h.x + 99, h.y], target: null }],
      nowMs: 0,
    });
    expect(r.type).toBe('error');
    const init = await loadInit(kv, season, { day: 4, today: 4, who: who('ed'), subreddit: 'test' });
    expect(init.me.tries).toBe(0);
  });

  it('a logged-out player sees the result but nothing is saved', async () => {
    const kv = memoryKV();
    const { ways } = await winningLine(4);
    const r = await recordAttempt(kv, season, {
      day: 4,
      today: 4,
      who: { userId: undefined, username: undefined, avatar: undefined },
      actions: ways[0]!.line,
      nowMs: 0,
    });
    if (r.type !== 'attempt') throw new Error('expected attempt');
    expect(r.win).toBe(true);
    expect(r.saved).toBe(false);
    expect(r.community.solvers).toBe(0);
  });

  it('every key that holds a player’s name, id or avatar expires within 30 days (Devvit Rules)', async () => {
    const kv = memoryKV();
    const { ways } = await winningLine(4);
    await setNation(kv, 't2_gi', 'concord');
    await recordAttempt(kv, season, { day: 4, today: 4, who: who('gi'), actions: ways[0]!.line, nowMs: dayStart(4) + 60_000 });
    for (const key of ['fw:u:t2_gi', 'fw:d4:u:t2_gi', 'fw:d4:ways', 'fw:d4:board', 'fw:d4:boardinfo']) {
      expect(kv.ttl.get(key), key).toBeLessThanOrEqual(RETENTION_SECONDS);
      expect(RETENTION_SECONDS).toBeLessThanOrEqual(30 * 86_400);
    }
  });

  it('nation and the warm-up flag persist, and nation solves are tallied', async () => {
    const kv = memoryKV();
    await setNation(kv, 't2_fi', 'tidebound');
    await markSeen(kv, 't2_fi');
    const { ways } = await winningLine(4);
    await recordAttempt(kv, season, { day: 4, today: 4, who: who('fi'), actions: ways[0]!.line, nowMs: 0 });
    const init = await loadInit(kv, season, { day: 4, today: 4, who: who('fi'), subreddit: 'test' });
    expect(init.me.nation).toBe('tidebound');
    expect(init.me.firstVisit).toBe(false);
    expect(init.community.nations.tidebound).toBe(1);
  });
});

describe('data retention follows the trial, not the latest play', () => {
  it('a trial’s shared records run out 30 days after the trial began, however late someone wins it', async () => {
    const kv = memoryKV();
    const { ways } = await winningLine(4);
    await recordAttempt(kv, season, { day: 4, today: 4, who: who('early'), actions: ways[0]!.line, nowMs: dayStart(4) + 60_000 });
    await recordAttempt(kv, season, { day: 4, today: 24, who: who('late'), actions: ways[0]!.line, nowMs: dayStart(24) });
    // Twenty days in, ten are left on the board that holds both names; the late winner did not reset the clock.
    expect(kv.ttl.get('fw:d4:board')).toBeLessThanOrEqual(10 * 86_400);
    expect(kv.ttl.get('fw:d4:ways')).toBeLessThanOrEqual(10 * 86_400);
    // The late player's own record still runs a full 30 days from their own play.
    expect(kv.ttl.get('fw:d4:u:t2_late')).toBe(RETENTION_SECONDS);
  });

  it('a player-built trial’s clock starts when it was posted', () => {
    const created = dayStart(10);
    expect(trialTtl(-7, created + DAY, created)).toBe(29 * 86_400);
    expect(trialTtl(4, dayStart(40), undefined)).toBe(3600); // long past: kept an hour, just enough to show a result
  });

  it('a player-built trial expires with the window, and goes when its maker deletes the post it went up in', async () => {
    const kv = memoryKV();
    const p = trialFor(season, 2).puzzle;
    const id = await saveForge(kv, { title: 'Gate', author: 'maker', puzzle: p, wayKeys: ['k'] }, dayStart(5));
    expect(kv.ttl.get(`fw:forge:${id}`)).toBeLessThanOrEqual(RETENTION_SECONDS);
    expect((await loadForge(kv, id))?.created).toBe(dayStart(5));
    await setForgePost(kv, id, 't3_original');
    expect(await forgetForge(kv, id, 't3_pickrepost')).toBe(false); // a mod removing the repost keeps the trial
    expect(await loadForge(kv, id)).not.toBeNull();
    expect(await forgetForge(kv, id, 't3_original')).toBe(true);
    expect(await loadForge(kv, id)).toBeNull();
  });
});

describe('chalk marks', () => {
  it('report the try the player first cleared on, not tries spent hunting later', async () => {
    const kv = memoryKV();
    const day = Array.from({ length: season.length }, (_, i) => i + 1).find((d) => trialFor(season, d).wayKeys.length >= 2)!;
    const { ways } = await winningLine(day);
    const base = { day, today: day, who: who('ch'), nowMs: dayStart(day) + 60_000 };
    await recordAttempt(kv, season, { ...base, actions: [] }); // a miss
    await recordAttempt(kv, season, { ...base, actions: ways[0]!.line }); // cleared on try 2
    await recordAttempt(kv, season, { ...base, actions: [] });
    await recordAttempt(kv, season, { ...base, actions: ways[1]!.line });
    const init = await loadInit(kv, season, { ...base, subreddit: 'test' });
    expect(init.me.tries).toBe(4);
    expect(init.me.clearTry).toBe(2);
  });

  it('are one per post per number of ways found, claimed atomically, and released if the comment fails', async () => {
    const kv = memoryKV();
    expect(await claimChalk(kv, 4, 't2_a', 't3_daily', 1)).toBe(true);
    expect(await claimChalk(kv, 4, 't2_a', 't3_daily', 1)).toBe(false); // a second tap or tab
    expect(await claimChalk(kv, 4, 't2_a', 't3_repost', 1)).toBe(true); // the same trial posted again has its own thread
    const seen = async (postId: string) => (await loadInit(kv, season, { day: 4, today: 4, who: who('a'), subreddit: 't', postId })).me.chalked;
    expect(await seen('t3_daily')).toBe(1);
    expect(await seen('t3_other')).toBe(0);
    expect(await claimChalk(kv, 4, 't2_a', 't3_daily', 2)).toBe(true); // found another way: one more mark
    await releaseChalk(kv, 4, 't2_a', 't3_daily', 2, 1); // that comment failed to post
    expect(await seen('t3_daily')).toBe(1);
    expect(await claimChalk(kv, 4, 't2_a', 't3_daily', 2)).toBe(true); // so it can be tried again
  });

  it('a win on a post already chalked says so, so the card does not offer a second mark', async () => {
    const kv = memoryKV();
    const { ways } = await winningLine(4);
    const base = { day: 4, today: 4, who: who('re'), nowMs: dayStart(4) + 60_000, postId: 't3_four' };
    await recordAttempt(kv, season, { ...base, actions: ways[0]!.line });
    expect(await claimChalk(kv, 4, 't2_re', 't3_four', 1)).toBe(true);
    const again = await recordAttempt(kv, season, { ...base, actions: ways[0]!.line });
    if (again.type !== 'attempt') throw new Error('expected attempt');
    expect(again.me.chalked).toBe(1);
  });
});
