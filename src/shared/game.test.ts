import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dateOfDay, dayNumber, EPOCH_UTC } from './engine/generator';
import { solve } from './engine/solver';
import { loadInit, markSeen, memoryKV, recordAttempt, RETENTION_SECONDS, type SeasonDay, setNation, trialFor } from './game';

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
    await recordAttempt(kv, season, { day: 4, today: 4, who: who('gi'), actions: ways[0]!.line, nowMs: 0 });
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
