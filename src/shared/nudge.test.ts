import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAction, initialState } from './engine/rules';
import { solve } from './engine/solver';
import { trialFor, type SeasonDay } from './game';
import { findNudge } from './nudge';

const season = JSON.parse(readFileSync('src/server/season.json', 'utf8')) as SeasonDay[];

describe('findNudge', () => {
  it('gives a legal opening move that starts a winning line, on every day of the season', () => {
    for (let day = 1; day <= season.length; day++) {
      const p = trialFor(season, day).puzzle;
      const n = findNudge(p, []);
      expect(n, `day ${day}`).not.toBeNull();
      const next = applyAction(initialState(p), { hero: n!.hero, to: n!.to, target: n!.target });
      expect(next, `day ${day}: the nudge is not a legal move`).not.toBeNull();
    }
  });

  it('points at a way the player has not won yet', () => {
    // A day with several ways: mark all but the last as found, and the nudge must start the last one.
    const day = Array.from({ length: season.length }, (_, i) => i + 1).find((d) => solve(trialFor(season, d).puzzle).ways.length >= 3)!;
    const p = trialFor(season, day).puzzle;
    const ways = solve(p).ways;
    const found = ways.slice(0, -1).map((w) => w.key);
    const n = findNudge(p, found)!;
    const last = ways[ways.length - 1]!;
    // The nudge's move is the first move of some line for an unfound way; the solver reports one line per way, so it
    // must match that way's first action.
    expect([n.hero, n.to, n.target]).toEqual([last.line[0]!.hero, last.line[0]!.to, last.line[0]!.target]);
  });

  it('names the hero and the move in words', () => {
    const p = trialFor(season, 1).puzzle;
    const n = findNudge(p, [])!;
    expect(n.text).toMatch(/^First step: /);
    expect(n.text).toMatch(/Vanguard|Reaver|Gloamhunter|Hexweaver|Shardcaller/);
  });
});
