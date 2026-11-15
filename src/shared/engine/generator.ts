// Builds daily trials backwards, so every one is winnable by construction, then hands each to the solver to confirm it,
// count its ways and rate it. Steps:
//   1. Terrain: a few rocks and chasms.
//   2. A solved arrangement: monsters placed so that, striking at once, every one is hit hard enough to fall.
//   3. For each hero, in reverse order, undo one use of its ability on one monster (un-shove, un-hurl, un-pull, un-swap,
//      or add the health a falling star will take away). A shove or hurl may instead drop an extra monster into a chasm.
//   4. Scatter the heroes within walking distance of where they act, and set lamps where idleness would put them out.
//   5. Replay the intended line, then solve: winnable, not winnable by doing nothing, every hero needed, ways in range.

import {
  CLASSES,
  type Action,
  type ClassId,
  DIR_LIST,
  DIR_VEC,
  type Enemy,
  forecast,
  type Hero,
  HERO_HP,
  initialState,
  type Lamp,
  manhattan,
  type MobId,
  playTurn,
  type Puzzle,
  resolveStrikes,
  type State,
} from './rules';
import type { Rng } from './rng';
import { solve } from './solver';

export type TierId = 'new' | 'crescent' | 'quarter' | 'gibbous' | 'full' | 'broken' | 'waning';

export type Tier = {
  id: TierId;
  /** Moon phase name shown on the splash. */
  moon: string;
  /** One word for difficulty. */
  feel: string;
  size: number;
  heroes: number;
  enemies: readonly [number, number];
  rocks: readonly [number, number];
  chasms: readonly [number, number];
  lamps: readonly [number, number];
  ways: readonly [number, number];
  /** Upper bound on the share of distinct hero-phase endings that win. Lower is harder. */
  maxWinRatio: number;
};

export const TIERS: Record<TierId, Tier> = {
  // Bands set from tools/calibrate.ts output on 15 November 2026 (win ratio is winning endings over all distinct endings).
  new: { id: 'new', moon: 'New Moon', feel: 'Gentle', size: 5, heroes: 1, enemies: [2, 2], rocks: [1, 3], chasms: [0, 1], lamps: [0, 1], ways: [1, 2], maxWinRatio: 0.3 },
  crescent: { id: 'crescent', moon: 'Waxing Crescent', feel: 'Easy', size: 5, heroes: 1, enemies: [3, 3], rocks: [1, 3], chasms: [0, 1], lamps: [0, 1], ways: [1, 3], maxWinRatio: 0.2 },
  quarter: { id: 'quarter', moon: 'First Quarter', feel: 'Steady', size: 6, heroes: 2, enemies: [3, 3], rocks: [2, 4], chasms: [0, 2], lamps: [1, 1], ways: [2, 4], maxWinRatio: 0.04 },
  gibbous: { id: 'gibbous', moon: 'Waxing Gibbous', feel: 'Tricky', size: 6, heroes: 2, enemies: [3, 4], rocks: [2, 4], chasms: [1, 2], lamps: [1, 1], ways: [2, 4], maxWinRatio: 0.025 },
  full: { id: 'full', moon: 'Full Moon', feel: 'Hard', size: 6, heroes: 2, enemies: [4, 4], rocks: [2, 4], chasms: [1, 2], lamps: [1, 2], ways: [2, 4], maxWinRatio: 0.02 },
  broken: { id: 'broken', moon: 'Broken Moon', feel: 'Fiendish', size: 6, heroes: 3, enemies: [4, 5], rocks: [2, 4], chasms: [1, 2], lamps: [1, 2], ways: [1, 3], maxWinRatio: 0.002 },
  waning: { id: 'waning', moon: 'Waning Moon', feel: 'Many paths', size: 6, heroes: 2, enemies: [3, 4], rocks: [2, 4], chasms: [1, 2], lamps: [1, 1], ways: [3, 6], maxWinRatio: 0.05 },
};

/** Sunday to Saturday, by UTC weekday. Saturday is the hardest: the night the moon broke. */
export const TIER_BY_WEEKDAY: readonly TierId[] = ['waning', 'new', 'crescent', 'quarter', 'gibbous', 'full', 'broken'];

const MOBS: readonly MobId[] = ['wolf', 'boar', 'thief', 'acolyte'];
const ALL_CLASSES: readonly ClassId[] = ['vanguard', 'reaver', 'gloamhunter', 'hexweaver', 'shardcaller'];

export type Generated = {
  puzzle: Puzzle;
  intended: Action[];
  ways: number;
  wayKeys: string[];
  winRatio: number;
  leaves: number;
};

type Work = { w: number; h: number; rows: string[]; enemies: Enemy[]; heroes: Hero[] };

const key = (x: number, y: number) => `${x},${y}`;

function stateOf(work: Work, lamps: Lamp[] = []): State {
  return initialState({ id: 'gen', w: work.w, h: work.h, rows: work.rows, heroes: work.heroes, enemies: work.enemies, lamps });
}

function openIn(work: Work, x: number, y: number, ignore?: string): boolean {
  if (x < 0 || y < 0 || x >= work.w || y >= work.h) return false;
  if ((work.rows[y] ?? '')[x] !== '.') return false;
  if (work.enemies.some((e) => e.id !== ignore && e.x === x && e.y === y)) return false;
  if (work.heroes.some((h) => h.id !== ignore && h.x === x && h.y === y)) return false;
  return true;
}

const isChasm = (work: Work, x: number, y: number) => x >= 0 && y >= 0 && x < work.w && y < work.h && (work.rows[y] ?? '')[x] === '~';

function makeTerrain(rng: Rng, size: number, rocks: number, chasms: number): string[] {
  const grid: string[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => '.'));
  const place = (c: string, n: number) => {
    for (let i = 0; i < n; i++) {
      for (let t = 0; t < 20; t++) {
        const x = rng.int(0, size - 1);
        const y = rng.int(0, size - 1);
        if (grid[y]![x] === '.') {
          grid[y]![x] = c;
          break;
        }
      }
    }
  };
  place('#', rocks);
  place('~', chasms);
  return grid.map((r) => r.join(''));
}

/** Monsters placed so that, striking at once, every one of them falls. */
function solvedArrangement(rng: Rng, work: Work, count: number): Enemy[] | null {
  for (let attempt = 0; attempt < 600; attempt++) {
    const ms: Enemy[] = [];
    let ok = true;
    for (let i = 0; i < count && ok; i++) {
      const mob = rng.pick(MOBS);
      const dir = rng.pick(DIR_LIST);
      const trial: Work = { ...work, enemies: ms, heroes: [] };
      let candidates: [number, number][] = [];
      if (ms.length > 0 && rng.chance(0.8)) {
        const s = stateOf(trial);
        for (const ev of forecast(s)) for (const t of ev.tiles) candidates.push(t);
      }
      candidates = candidates.filter(([x, y]) => openIn(trial, x, y));
      if (candidates.length === 0) {
        for (let y = 0; y < work.h; y++) for (let x = 0; x < work.w; x++) if (openIn(trial, x, y)) candidates.push([x, y]);
      }
      if (candidates.length === 0) {
        ok = false;
        break;
      }
      const [x, y] = rng.pick(candidates);
      ms.push({ id: `e${i + 1}`, side: 'enemy', mob, x, y, hp: 1, dir });
    }
    if (!ok) continue;
    const { state } = resolveStrikes(stateOf({ ...work, enemies: ms, heroes: [] }));
    if (state.fallen.length === ms.length) return ms;
  }
  return null;
}

type Step = { heroId: string; cls: ClassId; pre: [number, number]; end: [number, number]; target: [number, number] };

/** Undo one use of this hero's ability. Mutates `work` into the board as it stood before the hero acted. */
function undoAbility(rng: Rng, work: Work, cls: ClassId, heroId: string, used: Set<string>, extraId: () => string): Step | null {
  const pickable = rng.shuffle(work.enemies.filter((e) => !used.has(e.id)));
  const dirs = rng.shuffle(DIR_LIST);
  const chasms: [number, number][] = [];
  for (let y = 0; y < work.h; y++) for (let x = 0; x < work.w; x++) if (isChasm(work, x, y)) chasms.push([x, y]);

  const placeHero = (x: number, y: number) => {
    work.heroes.push({ id: heroId, side: 'hero', cls, x, y, hp: HERO_HP });
  };
  const newMonster = (x: number, y: number): Enemy => {
    const e: Enemy = { id: extraId(), side: 'enemy', mob: rng.pick(MOBS), x, y, hp: 1, dir: rng.pick(DIR_LIST) };
    work.enemies.push(e);
    return e;
  };

  switch (cls) {
    case 'vanguard': {
      // Variant: shove an extra monster into a chasm.
      if (chasms.length > 0 && rng.chance(0.35)) {
        for (const [cx, cy] of rng.shuffle(chasms)) {
          for (const d of dirs) {
            const [dx, dy] = DIR_VEC[d];
            const q: [number, number] = [cx - dx, cy - dy];
            const hpos: [number, number] = [cx - 2 * dx, cy - 2 * dy];
            if (openIn(work, ...q) && openIn(work, ...hpos)) {
              const m = newMonster(...q);
              used.add(m.id);
              placeHero(...hpos);
              return { heroId, cls, pre: hpos, end: hpos, target: q };
            }
          }
        }
      }
      for (const m of pickable) {
        for (const d of dirs) {
          const [dx, dy] = DIR_VEC[d];
          const q: [number, number] = [m.x - dx, m.y - dy];
          const hpos: [number, number] = [m.x - 2 * dx, m.y - 2 * dy];
          if (openIn(work, ...q, m.id) && openIn(work, ...hpos, m.id)) {
            m.x = q[0];
            m.y = q[1];
            used.add(m.id);
            placeHero(...hpos);
            return { heroId, cls, pre: hpos, end: hpos, target: q };
          }
        }
      }
      return null;
    }
    case 'reaver': {
      if (chasms.length > 0 && rng.chance(0.35)) {
        for (const [cx, cy] of rng.shuffle(chasms)) {
          for (const d of dirs) {
            const [dx, dy] = DIR_VEC[d];
            const hpos: [number, number] = [cx + dx, cy + dy];
            const b: [number, number] = [cx + 2 * dx, cy + 2 * dy];
            if (openIn(work, ...hpos) && openIn(work, ...b)) {
              const m = newMonster(...b);
              used.add(m.id);
              placeHero(...hpos);
              return { heroId, cls, pre: hpos, end: hpos, target: b };
            }
          }
        }
      }
      for (const m of pickable) {
        for (const d of dirs) {
          const [dx, dy] = DIR_VEC[d];
          const hpos: [number, number] = [m.x + dx, m.y + dy];
          const b: [number, number] = [m.x + 2 * dx, m.y + 2 * dy];
          if (openIn(work, ...hpos, m.id) && openIn(work, ...b, m.id)) {
            m.x = b[0];
            m.y = b[1];
            used.add(m.id);
            placeHero(...hpos);
            return { heroId, cls, pre: hpos, end: hpos, target: b };
          }
        }
      }
      return null;
    }
    case 'gloamhunter': {
      for (const m of pickable) {
        for (const d of dirs) {
          const [dx, dy] = DIR_VEC[d];
          const hpos: [number, number] = [m.x - dx, m.y - dy];
          if (!openIn(work, ...hpos, m.id)) continue;
          for (const j of rng.shuffle([2, 3, 4])) {
            let clear = true;
            for (let i = 1; i <= j; i++) {
              if (!openIn(work, hpos[0] + dx * i, hpos[1] + dy * i, m.id)) clear = false;
            }
            if (!clear) continue;
            const b: [number, number] = [hpos[0] + dx * j, hpos[1] + dy * j];
            m.x = b[0];
            m.y = b[1];
            used.add(m.id);
            placeHero(...hpos);
            return { heroId, cls, pre: hpos, end: hpos, target: b };
          }
        }
      }
      return null;
    }
    case 'hexweaver': {
      for (const m of pickable) {
        const spots: [number, number][] = [];
        for (let y = 0; y < work.h; y++)
          for (let x = 0; x < work.w; x++) {
            const dist = manhattan(x, y, m.x, m.y);
            if (dist >= 1 && dist <= 3 && openIn(work, x, y, m.id)) spots.push([x, y]);
          }
        if (spots.length === 0) continue;
        const [mx, my] = rng.pick(spots);
        const p: [number, number] = [m.x, m.y];
        m.x = mx;
        m.y = my;
        used.add(m.id);
        // The hero ends where the monster started, and acted from where the monster ends.
        placeHero(mx, my);
        // Temporarily the hero and monster share a tile in this record; the hero's start tile is chosen later.
        return { heroId, cls, pre: p, end: [mx, my], target: [mx, my] };
      }
      return null;
    }
    case 'shardcaller': {
      // Variant: an extra monster the star must fell outright. Otherwise a monster in the arrangement gets one more health.
      let m: Enemy | undefined;
      if (rng.chance(0.4)) {
        const spots: [number, number][] = [];
        for (let y = 0; y < work.h; y++) for (let x = 0; x < work.w; x++) if (openIn(work, x, y)) spots.push([x, y]);
        if (spots.length > 0) m = newMonster(...rng.pick(spots));
      } else {
        m = pickable[0];
        if (m) m.hp += 1;
      }
      if (!m) return null;
      used.add(m.id);
      const spots: [number, number][] = [];
      for (let y = 0; y < work.h; y++)
        for (let x = 0; x < work.w; x++) {
          const dist = manhattan(x, y, m.x, m.y);
          if (dist >= 2 && dist <= 3 && openIn(work, x, y)) spots.push([x, y]);
        }
      if (spots.length === 0) return null;
      const hpos = rng.pick(spots);
      placeHero(...hpos);
      return { heroId, cls, pre: hpos, end: hpos, target: [m.x, m.y] };
    }
  }
}

export function generateTrial(rng: Rng, tier: Tier, id: string, attempts = 400): Generated | null {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const g = tryOnce(rng, tier, id);
    if (g) return g;
  }
  return null;
}

function tryOnce(rng: Rng, tier: Tier, id: string): Generated | null {
  const size = tier.size;
  const rows = makeTerrain(rng, size, rng.int(...tier.rocks), rng.int(...tier.chasms));
  const work: Work = { w: size, h: size, rows, enemies: [], heroes: [] };
  const total = rng.int(...tier.enemies);
  const classes = rng.shuffle(ALL_CLASSES).slice(0, tier.heroes);
  // Extras (chasm drops, star-only kills) are added by undoAbility, so the arrangement may hold fewer monsters.
  const arranged = Math.max(2, total - (classes.length > 1 ? rng.int(0, 1) : 0));
  const ms = solvedArrangement(rng, work, arranged);
  if (!ms) return null;
  work.enemies = ms;
  let extra = ms.length;
  const extraId = () => `e${++extra}`;

  // Undo the heroes' abilities in reverse order of the order they will act.
  const used = new Set<string>();
  const steps: Step[] = [];
  const order = classes.map((cls, i) => ({ cls, heroId: `h${i + 1}` }));
  for (const { cls, heroId } of [...order].reverse()) {
    const step = undoAbility(rng, work, cls, heroId, used, extraId);
    if (!step) return null;
    steps.unshift(step);
  }
  if (work.enemies.length < tier.enemies[0] || work.enemies.length > tier.enemies[1]) return null;
  // Variety: a board of one kind of monster reads flat. Two kinds from 2 or 3 monsters, three kinds from 4 or more.
  const kinds = new Set(work.enemies.map((e) => e.mob)).size;
  if (kinds < (work.enemies.length >= 4 ? 3 : 2)) return null;

  // Scatter each hero to a start tile within walking distance of the tile it acts from.
  for (const step of steps) {
    const hero = work.heroes.find((h) => h.id === step.heroId);
    if (!hero) return null;
    const move = CLASSES[step.cls].move;
    const options: [number, number][] = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const dist = manhattan(x, y, step.pre[0], step.pre[1]);
        if (dist >= 1 && dist <= move && openIn(work, x, y, hero.id)) options.push([x, y]);
      }
    if (options.length === 0) return null;
    const [sx, sy] = rng.pick(options);
    hero.x = sx;
    hero.y = sy;
  }

  const intended: Action[] = steps.map((s) => ({ hero: s.heroId, to: s.pre, target: s.target }));

  // Lamps: on tiles the intended ending leaves safe, preferring tiles the monsters threaten if nobody acts.
  const lampCount = rng.int(...tier.lamps);
  const lamps: Lamp[] = [];
  if (lampCount > 0) {
    const base: Puzzle = { id, w: size, h: size, rows, heroes: work.heroes, enemies: work.enemies, lamps: [] };
    const played = playTurn(base, intended);
    if (!played) return null;
    const endTiles = new Set<string>();
    for (const ev of played.events) for (const [x, y] of ev.tiles) endTiles.add(key(x, y));
    const startThreat = new Set<string>();
    for (const ev of forecast(initialState(base))) for (const [x, y] of ev.tiles) startThreat.add(key(x, y));
    const blocked = new Set<string>();
    for (const s of steps) {
      blocked.add(key(...s.pre));
      blocked.add(key(...s.end));
      blocked.add(key(...s.target));
    }
    const free: [number, number][] = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (!openIn(work, x, y) || endTiles.has(key(x, y)) || blocked.has(key(x, y))) continue;
        free.push([x, y]);
      }
    const threatened = rng.shuffle(free.filter(([x, y]) => startThreat.has(key(x, y))));
    const rest = rng.shuffle(free.filter(([x, y]) => !startThreat.has(key(x, y))));
    const pool = [...threatened, ...rest];
    for (let i = 0; i < lampCount && i < pool.length; i++) {
      const [x, y] = pool[i]!;
      lamps.push({ id: `l${i + 1}`, x, y, lit: true });
    }
    if (lamps.length < lampCount) return null;
  }

  const puzzle: Puzzle = {
    id,
    w: size,
    h: size,
    rows,
    heroes: work.heroes.map((h) => ({ ...h })).sort((a, b) => a.id.localeCompare(b.id)),
    enemies: work.enemies.map((e) => ({ ...e })).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))),
    lamps,
  };

  // The intended line must actually win.
  const check = playTurn(puzzle, intended);
  if (!check || !check.outcome.win) return null;

  const res = solve(puzzle, { budget: 1_500_000 });
  if (res.truncated || res.trivial) return null;
  if (res.ways.length < tier.ways[0] || res.ways.length > tier.ways[1]) return null;
  const winRatio = res.winningLeaves / Math.max(1, res.leaves);
  if (winRatio > tier.maxWinRatio) return null;
  // Every hero must matter: with any one hero idle, the trial cannot be won.
  if (puzzle.heroes.length > 1) {
    for (const h of puzzle.heroes) {
      if (solve(puzzle, { idle: [h.id], budget: 600_000, stopAtWays: 1 }).ways.length > 0) return null;
    }
  }
  // A monster threatening nothing at the start makes the opening read as flat; require at least one live threat.
  const opening = forecast(initialState(puzzle));
  if (!opening.some((ev) => ev.hits.length > 0 || ev.lampsOut.length > 0)) return null;

  return { puzzle, intended, ways: res.ways.length, wayKeys: res.ways.map((w) => w.key), winRatio, leaves: res.leaves };
}

export type Dated = { day: number; date: string; tier: TierId };

/** Day 1 is Sunday 15 November 2026, the day the first trial went up. */
export const EPOCH_UTC = Date.UTC(2026, 10, 15);
const DAY_MS = 86_400_000;

export function dayNumber(nowMs: number): number {
  return Math.floor((nowMs - EPOCH_UTC) / DAY_MS) + 1;
}

export function dateOfDay(day: number): Dated {
  const ms = EPOCH_UTC + (day - 1) * DAY_MS;
  const d = new Date(ms);
  return { day, date: d.toISOString().slice(0, 10), tier: TIER_BY_WEEKDAY[d.getUTCDay()] ?? 'quarter' };
}
