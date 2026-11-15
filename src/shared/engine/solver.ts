// Exhaustive solver. Explores every order of heroes, every reachable tile and every ability target (or none), with
// duplicate states merged, then resolves the monsters' strikes on every distinct end of the hero phase.
//
// A "way" is a distinct answer to "which monster fell to what" (see wayKey in rules.ts). Two lines that differ only in
// where an idle hero stood are the same way, which is how players describe solutions to each other.

import {
  abilityTargets,
  type Action,
  applyAction,
  type Hero,
  heroes,
  initialState,
  outcomeOf,
  type Puzzle,
  reachable,
  resolveStrikes,
  type State,
} from './rules';

export type SolveResult = {
  /** Distinct ways to win, each with one example line of actions. */
  ways: { key: string; line: Action[] }[];
  /** Distinct end-of-hero-phase states examined. */
  leaves: number;
  /** How many of those leaves win. */
  winningLeaves: number;
  /** True if pressing Strike without doing anything already wins (a broken trial). */
  trivial: boolean;
  /** True if the search stopped at the node budget before finishing. */
  truncated: boolean;
};

function stateKey(s: State): string {
  const u = s.units
    .map((v) => `${v.id}${v.x},${v.y},${v.hp}`)
    .sort()
    .join(';');
  const l = s.lamps.map((v) => (v.lit ? '1' : '0')).join('');
  const f = s.fallen
    .map((v) => `${v.id}<${v.cause}`)
    .sort()
    .join(';');
  return `${u}|${l}|${f}|${[...s.acted].sort().join(',')}|${s.lost.map((l) => l.id).join(',')}`;
}

export type SolveOptions = {
  /** Hero ids forced to skip (stand still, no ability). Used to test whether a hero is needed. */
  idle?: string[];
  /** Stop after this many expanded nodes. */
  budget?: number;
  /** Stop as soon as this many distinct ways are found. */
  stopAtWays?: number;
};

export function solve(p: Puzzle, opts: SolveOptions = {}): SolveResult {
  const budget = opts.budget ?? 2_000_000;
  const idle = new Set(opts.idle ?? []);
  const start = initialState(p);
  const visited = new Set<string>();
  const ways = new Map<string, Action[]>();
  let leaves = 0;
  let winningLeaves = 0;
  let nodes = 0;
  let truncated = false;

  const noop = outcomeOf(resolveStrikes(start).state);
  const trivial = noop.win;

  const leaf = (s: State, line: Action[]) => {
    leaves++;
    const o = outcomeOf(resolveStrikes(s).state);
    if (o.win) {
      winningLeaves++;
      if (!ways.has(o.wayKey)) ways.set(o.wayKey, line);
    }
  };

  const dfs = (s: State, line: Action[]) => {
    if (truncated) return;
    if (opts.stopAtWays && ways.size >= opts.stopAtWays) return;
    const key = stateKey(s);
    if (visited.has(key)) return;
    visited.add(key);
    if (++nodes > budget) {
      truncated = true;
      return;
    }
    const pending = heroes(s).filter((h) => !s.acted.includes(h.id));
    // A hero that fell during the hero phase can never act; the turn is lost, but resolve it anyway for counting.
    if (pending.length === 0) {
      leaf(s, line);
      return;
    }
    for (const h of pending) {
      if (idle.has(h.id)) {
        const a: Action = { hero: h.id, to: [h.x, h.y], target: null };
        const next = applyAction(s, a);
        if (next) dfs(next, [...line, a]);
        continue;
      }
      for (const [x, y] of reachable(s, h)) {
        const moved = applyAction(s, { hero: h.id, to: [x, y], target: null });
        if (!moved) continue;
        // Option 1: move and do nothing.
        dfs(moved, [...line, { hero: h.id, to: [x, y], target: null }]);
        // Option 2: move, then use the ability on each legal target from the new tile.
        const probe = initialProbe(s, h.id, x, y);
        const ph = probe.units.find((u): u is Hero => u.id === h.id && u.side === 'hero');
        if (!ph) continue;
        for (const t of abilityTargets(probe, ph)) {
          const a: Action = { hero: h.id, to: [x, y], target: t };
          const next = applyAction(s, a);
          if (next) dfs(next, [...line, a]);
        }
      }
    }
  };

  dfs(start, []);
  return {
    ways: [...ways.entries()].map(([key, line]) => ({ key, line })).sort((a, b) => a.key.localeCompare(b.key)),
    leaves,
    winningLeaves,
    trivial,
    truncated,
  };
}

/** The state with only the hero moved, so ability targets are computed from its destination. */
function initialProbe(s: State, heroId: string, x: number, y: number): State {
  return {
    ...s,
    units: s.units.map((u) => (u.id === heroId ? { ...u, x, y } : u)),
  };
}
