// Forged trials: boards a redditor builds and posts for the subreddit. The same checks run in the builder (for live
// feedback) and on the server (the one that counts). A trial is accepted only if its maker proves it by clearing it,
// it cannot be won by doing nothing, the solver can finish it within budget, and it fits the size limits.

import { type Action, type ClassId, DIR_LIST, type Enemy, type Hero, type Lamp, type MobId, playTurn, type Puzzle } from './engine/rules';
import { solve } from './engine/solver';

export const FORGE_SIZE = 6;
export const FORGE_LIMITS = { heroes: [1, 3], enemies: [2, 5], lamps: [0, 2], titleChars: 40 } as const;
const CLASS_IDS: readonly ClassId[] = ['vanguard', 'reaver', 'gloamhunter', 'hexweaver', 'shardcaller'];
const MOB_IDS: readonly MobId[] = ['wolf', 'boar', 'thief', 'acolyte'];

export type ForgeCheck =
  | { ok: true; ways: number; wayKeys: string[] }
  | { ok: false; reason: string };

/** Rebuild a puzzle from untrusted input: fixed size, known tiles and kinds, fresh ids, one piece per tile. */
export function normalizeForge(input: unknown): Puzzle | null {
  if (typeof input !== 'object' || input === null) return null;
  const p = input as Partial<Puzzle>;
  const rows = Array.isArray(p.rows) ? p.rows : [];
  if (rows.length !== FORGE_SIZE) return null;
  const clean: string[] = [];
  for (const r of rows) {
    if (typeof r !== 'string' || r.length !== FORGE_SIZE || /[^.#~]/.test(r)) return null;
    clean.push(r);
  }
  const taken = new Set<string>();
  const free = (x: unknown, y: unknown): [number, number] | null => {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
    const nx = x as number;
    const ny = y as number;
    if (nx < 0 || ny < 0 || nx >= FORGE_SIZE || ny >= FORGE_SIZE) return null;
    if (clean[ny]![nx] !== '.') return null;
    const k = `${nx},${ny}`;
    if (taken.has(k)) return null;
    taken.add(k);
    return [nx, ny];
  };
  const heroes: Hero[] = [];
  for (const h of Array.isArray(p.heroes) ? p.heroes : []) {
    if (!CLASS_IDS.includes(h?.cls as ClassId)) return null;
    const at = free(h.x, h.y);
    if (!at) return null;
    heroes.push({ id: `h${heroes.length + 1}`, side: 'hero', cls: h.cls, x: at[0], y: at[1], hp: 1 });
  }
  const enemies: Enemy[] = [];
  for (const e of Array.isArray(p.enemies) ? p.enemies : []) {
    if (!MOB_IDS.includes(e?.mob as MobId) || !DIR_LIST.includes(e.dir)) return null;
    const hp = e.hp === 2 ? 2 : 1;
    const at = free(e.x, e.y);
    if (!at) return null;
    enemies.push({ id: `e${enemies.length + 1}`, side: 'enemy', mob: e.mob, x: at[0], y: at[1], hp, dir: e.dir });
  }
  const lamps: Lamp[] = [];
  for (const l of Array.isArray(p.lamps) ? p.lamps : []) {
    const at = free(l?.x, l?.y);
    if (!at) return null;
    lamps.push({ id: `l${lamps.length + 1}`, x: at[0], y: at[1], lit: true });
  }
  return { id: 'forge', w: FORGE_SIZE, h: FORGE_SIZE, rows: clean, heroes, enemies, lamps };
}

/** What is missing before a board can even be checked, or null when its pieces are within the limits. */
export function forgeShortfall(p: Puzzle): string | null {
  const [hMin, hMax] = FORGE_LIMITS.heroes;
  const [eMin, eMax] = FORGE_LIMITS.enemies;
  if (p.heroes.length < hMin) return 'Place at least one hero.';
  if (p.heroes.length > hMax) return `At most ${hMax} heroes.`;
  if (new Set(p.heroes.map((h) => h.cls)).size !== p.heroes.length) return 'Each hero must be a different class.';
  if (p.enemies.length < eMin) return `Place at least ${eMin} monsters.`;
  if (p.enemies.length > eMax) return `At most ${eMax} monsters.`;
  if (p.lamps.length > FORGE_LIMITS.lamps[1]) return `At most ${FORGE_LIMITS.lamps[1]} lamps.`;
  return null;
}

/** Can this board be won, and how many ways? Runs the full solver, so call it on a button, not on every tap. */
export function checkForge(p: Puzzle, budget = 600_000): ForgeCheck {
  const short = forgeShortfall(p);
  if (short) return { ok: false, reason: short };
  const res = solve(p, { budget });
  if (res.truncated) return { ok: false, reason: 'Too many possibilities to check. Remove a hero or a monster.' };
  if (res.trivial) return { ok: false, reason: 'It is already won if nobody moves. Make the monsters miss each other first.' };
  if (res.ways.length === 0) return { ok: false, reason: 'No way to win it yet. Every monster must fall and every hero and lamp survive.' };
  return { ok: true, ways: res.ways.length, wayKeys: res.ways.map((w) => w.key) };
}

/** The server's check: the board is valid and the maker's own turn wins it. */
export function verifyForge(input: unknown, proof: unknown, budget = 600_000): { puzzle: Puzzle; check: ForgeCheck } | { error: string } {
  const puzzle = normalizeForge(input);
  if (!puzzle) return { error: 'That board is not valid.' };
  if (!Array.isArray(proof) || proof.length > puzzle.heroes.length) return { error: 'The proof does not match the heroes.' };
  const played = playTurn(puzzle, proof as Action[]);
  if (!played) return { error: 'The proof turn is not legal on this board.' };
  if (!played.outcome.win) return { error: 'The proof turn does not win. Clear your own trial first.' };
  const check = checkForge(puzzle, budget);
  if (!check.ok) return { error: check.reason };
  return { puzzle, check };
}

/** A short, single-line title. Empty is allowed; the post then gets a default. */
export function cleanTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, FORGE_LIMITS.titleChars);
}
