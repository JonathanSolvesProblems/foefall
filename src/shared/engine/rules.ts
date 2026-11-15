// Foefall rules engine. Pure and deterministic: the client runs it for the live forecast, the server runs it to check
// every claimed win, and the solver runs it to prove each daily trial can be won and to count its ways.
//
// One turn, perfect information. Every monster shows the tiles it will strike. Each hero may move and then use one
// ability, in any order. Then every surviving monster strikes at the same moment.
// Win: every monster down, every hero standing, every lamp still lit.
//
// Why at the same moment: with strikes in sequence, the last monster to strike can never be hit afterwards, so a full
// clear through strikes would be impossible. Simultaneous strikes let two monsters fell each other, which is the puzzle.

export type Dir = 'N' | 'E' | 'S' | 'W';
export const DIR_LIST: readonly Dir[] = ['N', 'E', 'S', 'W'];
export const DIR_VEC: Record<Dir, readonly [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export type Tile = 'floor' | 'rock' | 'chasm';
export type ClassId = 'vanguard' | 'reaver' | 'gloamhunter' | 'hexweaver' | 'shardcaller';
export type MobId = 'wolf' | 'boar' | 'thief' | 'acolyte';

export type Hero = { id: string; side: 'hero'; cls: ClassId; x: number; y: number; hp: number };
export type Enemy = { id: string; side: 'enemy'; mob: MobId; x: number; y: number; hp: number; dir: Dir };
export type Unit = Hero | Enemy;
export type Lamp = { id: string; x: number; y: number; lit: boolean };

/** How a monster went down. `strike:<ids>` means other monsters' strikes felled it (ids sorted, joined by `+`). */
export type Cause = 'fall' | 'bump' | 'starfall' | `strike:${string}`;

export type Puzzle = {
  id: string;
  w: number;
  h: number;
  /** One string per row: `.` floor, `#` rock, `~` chasm. */
  rows: string[];
  heroes: Hero[];
  enemies: Enemy[];
  lamps: Lamp[];
};

export type State = {
  w: number;
  h: number;
  tiles: Tile[];
  units: Unit[];
  lamps: Lamp[];
  /** Hero ids that have taken their action this turn. */
  acted: string[];
  /** Monsters that have gone down, with how and where. Order is the order they fell. */
  fallen: { id: string; cause: Cause; x: number; y: number }[];
  /** Heroes that have gone down, and where. */
  lost: { id: string; x: number; y: number }[];
};

/** One hero's action: where it moves (its own tile to stay), then the tile it targets with its ability, or none. */
export type Action = { hero: string; to: readonly [number, number]; target: readonly [number, number] | null };

export type ClassDef = {
  id: ClassId;
  name: string;
  ability: string;
  move: number;
  /** One line, shown in the hero card and the help sheet. */
  blurb: string;
};

export const CLASSES: Record<ClassId, ClassDef> = {
  vanguard: { id: 'vanguard', name: 'Vanguard', ability: 'Shield Bash', move: 3, blurb: 'Shove an adjacent creature one tile away.' },
  reaver: { id: 'reaver', name: 'Reaver', ability: 'Hurl', move: 3, blurb: 'Throw an adjacent creature over your head to the far side.' },
  gloamhunter: { id: 'gloamhunter', name: 'Gloamhunter', ability: 'Tetherline', move: 3, blurb: 'Hook the first creature in a line and drag it to you.' },
  hexweaver: { id: 'hexweaver', name: 'Hexweaver', ability: 'Unwrite', move: 2, blurb: 'Swap places with anyone within 3 tiles.' },
  shardcaller: { id: 'shardcaller', name: 'Shardcaller', ability: 'Starfall', move: 2, blurb: 'Drop a falling star on a creature 2 or 3 tiles away.' },
};

export type MobDef = { id: MobId; name: string; attack: string; blurb: string; directional: boolean };

export const MOBS: Record<MobId, MobDef> = {
  wolf: { id: 'wolf', name: 'Duskfield Wolf', attack: 'Lunge', blurb: 'Bites the tile it faces.', directional: true },
  boar: { id: 'boar', name: 'Thornback Boar', attack: 'Thorn Shake', blurb: 'Shakes out thorns on all four sides.', directional: false },
  thief: { id: 'thief', name: 'Shardrunner Thief', attack: 'Knife Throw', blurb: 'Throws a knife that hits the first thing in its path.', directional: true },
  acolyte: { id: 'acolyte', name: 'Cinder Acolyte', attack: 'Cinderfall', blurb: 'Calls fire down in a cross two tiles ahead.', directional: true },
};

export const HERO_HP = 1;

// ---------------------------------------------------------------------------------------------------------------------
// Construction and lookup

export function parseTile(c: string): Tile {
  if (c === '#') return 'rock';
  if (c === '~') return 'chasm';
  return 'floor';
}

export function initialState(p: Puzzle): State {
  const tiles: Tile[] = [];
  for (let y = 0; y < p.h; y++) {
    const row = p.rows[y] ?? '';
    for (let x = 0; x < p.w; x++) tiles.push(parseTile(row[x] ?? '.'));
  }
  return {
    w: p.w,
    h: p.h,
    tiles,
    units: [...p.heroes.map((u) => ({ ...u })), ...p.enemies.map((u) => ({ ...u }))],
    lamps: p.lamps.map((l) => ({ ...l })),
    acted: [],
    fallen: [],
    lost: [],
  };
}

export function cloneState(s: State): State {
  return {
    w: s.w,
    h: s.h,
    tiles: s.tiles,
    units: s.units.map((u) => ({ ...u })),
    lamps: s.lamps.map((l) => ({ ...l })),
    acted: [...s.acted],
    fallen: s.fallen.map((f) => ({ ...f })),
    lost: s.lost.map((l) => ({ ...l })),
  };
}

export const inBounds = (s: Pick<State, 'w' | 'h'>, x: number, y: number) => x >= 0 && y >= 0 && x < s.w && y < s.h;
export const tileAt = (s: State, x: number, y: number): Tile => s.tiles[y * s.w + x] ?? 'rock';
export const unitAt = (s: State, x: number, y: number): Unit | undefined => s.units.find((u) => u.x === x && u.y === y);
export const lampAt = (s: State, x: number, y: number): Lamp | undefined => s.lamps.find((l) => l.x === x && l.y === y);
export const unitById = (s: State, id: string): Unit | undefined => s.units.find((u) => u.id === id);
export const heroes = (s: State): Hero[] => s.units.filter((u): u is Hero => u.side === 'hero');
export const enemies = (s: State): Enemy[] => s.units.filter((u): u is Enemy => u.side === 'enemy');
export const manhattan = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) + Math.abs(ay - by);

/** A tile a unit can stand on or be moved onto without falling: in bounds, floor, and empty. */
export function isOpen(s: State, x: number, y: number): boolean {
  return inBounds(s, x, y) && tileAt(s, x, y) === 'floor' && !unitAt(s, x, y) && !lampAt(s, x, y);
}

// ---------------------------------------------------------------------------------------------------------------------
// Damage and forced movement

function damage(s: State, u: Unit, amount: number, cause: Cause): void {
  u.hp -= amount;
  if (u.hp <= 0) remove(s, u, cause);
}

function remove(s: State, u: Unit, cause: Cause): void {
  s.units = s.units.filter((v) => v.id !== u.id);
  if (u.side === 'enemy') s.fallen.push({ id: u.id, cause, x: u.x, y: u.y });
  else s.lost.push({ id: u.id, x: u.x, y: u.y });
}

/**
 * Push a unit one tile. Off the board: nothing. Into rock or a lamp: the unit takes 1. Into another unit: both take 1.
 * Onto a chasm: it falls. Onto open floor: it moves.
 */
export function push(s: State, u: Unit, dir: Dir): void {
  const [dx, dy] = DIR_VEC[dir];
  const nx = u.x + dx;
  const ny = u.y + dy;
  if (!inBounds(s, nx, ny)) return;
  const other = unitAt(s, nx, ny);
  if (other) {
    damage(s, u, 1, 'bump');
    damage(s, other, 1, 'bump');
    return;
  }
  if (tileAt(s, nx, ny) === 'rock' || lampAt(s, nx, ny)) {
    damage(s, u, 1, 'bump');
    return;
  }
  u.x = nx;
  u.y = ny;
  if (tileAt(s, nx, ny) === 'chasm') remove(s, u, 'fall');
}

function dirBetween(ax: number, ay: number, bx: number, by: number): Dir | null {
  if (ax === bx && by === ay - 1) return 'N';
  if (ax === bx && by === ay + 1) return 'S';
  if (ay === by && bx === ax + 1) return 'E';
  if (ay === by && bx === ax - 1) return 'W';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Hero movement

/** Tiles the hero can end its move on (including where it stands), by walking over open floor. */
export function reachable(s: State, hero: Hero): [number, number][] {
  const range = CLASSES[hero.cls].move;
  const seen = new Set<number>([hero.y * s.w + hero.x]);
  const out: [number, number][] = [[hero.x, hero.y]];
  let frontier: [number, number][] = [[hero.x, hero.y]];
  for (let step = 0; step < range; step++) {
    const next: [number, number][] = [];
    for (const [x, y] of frontier) {
      for (const d of DIR_LIST) {
        const [dx, dy] = DIR_VEC[d];
        const nx = x + dx;
        const ny = y + dy;
        const k = ny * s.w + nx;
        if (seen.has(k) || !isOpen(s, nx, ny)) continue;
        seen.add(k);
        next.push([nx, ny]);
        out.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Abilities

/** The tiles this hero may target with its ability from where it stands now. */
export function abilityTargets(s: State, hero: Hero): [number, number][] {
  const out: [number, number][] = [];
  switch (hero.cls) {
    case 'vanguard': {
      for (const d of DIR_LIST) {
        const [dx, dy] = DIR_VEC[d];
        if (unitAt(s, hero.x + dx, hero.y + dy)) out.push([hero.x + dx, hero.y + dy]);
      }
      break;
    }
    case 'reaver': {
      for (const d of DIR_LIST) {
        const [dx, dy] = DIR_VEC[d];
        const t = unitAt(s, hero.x + dx, hero.y + dy);
        if (!t) continue;
        const lx = hero.x - dx;
        const ly = hero.y - dy;
        if (!inBounds(s, lx, ly)) continue;
        if (tileAt(s, lx, ly) === 'chasm' || isOpen(s, lx, ly)) out.push([t.x, t.y]);
      }
      break;
    }
    case 'gloamhunter': {
      for (const d of DIR_LIST) {
        const t = tetherTarget(s, hero, d);
        if (t) out.push([t.x, t.y]);
      }
      break;
    }
    case 'hexweaver': {
      for (const u of s.units) {
        if (u.id === hero.id) continue;
        const dist = manhattan(hero.x, hero.y, u.x, u.y);
        if (dist >= 1 && dist <= 3) out.push([u.x, u.y]);
      }
      break;
    }
    case 'shardcaller': {
      for (const u of s.units) {
        if (u.id === hero.id) continue;
        const dist = manhattan(hero.x, hero.y, u.x, u.y);
        if (dist >= 2 && dist <= 3) out.push([u.x, u.y]);
      }
      break;
    }
  }
  return out;
}

const TETHER_RANGE = 5;

/** The first creature in a straight line, 2 to 5 tiles away, with nothing solid in between. */
function tetherTarget(s: State, hero: Hero, d: Dir): Unit | null {
  const [dx, dy] = DIR_VEC[d];
  for (let i = 1; i <= TETHER_RANGE; i++) {
    const x = hero.x + dx * i;
    const y = hero.y + dy * i;
    if (!inBounds(s, x, y)) return null;
    if (tileAt(s, x, y) === 'rock' || lampAt(s, x, y)) return null;
    const u = unitAt(s, x, y);
    if (u) return i >= 2 ? u : null;
  }
  return null;
}

/** Apply the hero's ability to the unit on (tx, ty). Returns false if the target is not legal. */
function useAbility(s: State, hero: Hero, tx: number, ty: number): boolean {
  const legal = abilityTargets(s, hero).some(([x, y]) => x === tx && y === ty);
  if (!legal) return false;
  const t = unitAt(s, tx, ty);
  if (!t) return false;
  switch (hero.cls) {
    case 'vanguard': {
      const d = dirBetween(hero.x, hero.y, tx, ty);
      if (d) push(s, t, d);
      return true;
    }
    case 'reaver': {
      const d = dirBetween(hero.x, hero.y, tx, ty);
      if (!d) return false;
      const [dx, dy] = DIR_VEC[d];
      t.x = hero.x - dx;
      t.y = hero.y - dy;
      if (tileAt(s, t.x, t.y) === 'chasm') remove(s, t, 'fall');
      return true;
    }
    case 'gloamhunter': {
      const d = (Object.keys(DIR_VEC) as Dir[]).find((k) => {
        const [dx, dy] = DIR_VEC[k];
        return Math.sign(tx - hero.x) === dx && Math.sign(ty - hero.y) === dy;
      });
      if (!d) return false;
      const back = OPPOSITE[d];
      // Drag it toward the hunter one tile at a time until it is adjacent, blocked, or falls.
      while (manhattan(hero.x, hero.y, t.x, t.y) > 1) {
        const [bx, by] = DIR_VEC[back];
        const nx = t.x + bx;
        const ny = t.y + by;
        if (tileAt(s, nx, ny) === 'chasm') {
          t.x = nx;
          t.y = ny;
          remove(s, t, 'fall');
          break;
        }
        if (!isOpen(s, nx, ny)) break;
        t.x = nx;
        t.y = ny;
      }
      return true;
    }
    case 'hexweaver': {
      const hx = hero.x;
      const hy = hero.y;
      hero.x = t.x;
      hero.y = t.y;
      t.x = hx;
      t.y = hy;
      return true;
    }
    case 'shardcaller': {
      damage(s, t, 1, 'starfall');
      return true;
    }
  }
}

export const OPPOSITE: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };

/**
 * Apply one hero action to a copy of the state. Returns null if the action is illegal (hero gone or already acted,
 * destination not reachable, or the ability target not legal from the destination).
 */
export function applyAction(s0: State, a: Action): State | null {
  const s = cloneState(s0);
  const hero = unitById(s, a.hero);
  if (!hero || hero.side !== 'hero' || s.acted.includes(hero.id)) return null;
  const [tx, ty] = a.to;
  if (!reachable(s, hero).some(([x, y]) => x === tx && y === ty)) return null;
  hero.x = tx;
  hero.y = ty;
  if (a.target) {
    if (!useAbility(s, hero, a.target[0], a.target[1])) return null;
  }
  s.acted.push(hero.id);
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------
// The monsters' strikes

/** The tiles an enemy will strike from where it stands now. For the thief, only the tile its knife will land on. */
export function strikeTiles(s: State, e: Enemy): [number, number][] {
  const [dx, dy] = DIR_VEC[e.dir];
  switch (e.mob) {
    case 'wolf':
      return inBounds(s, e.x + dx, e.y + dy) ? [[e.x + dx, e.y + dy]] : [];
    case 'boar':
      return DIR_LIST.map((d) => [e.x + DIR_VEC[d][0], e.y + DIR_VEC[d][1]] as [number, number]).filter(([x, y]) => inBounds(s, x, y));
    case 'thief': {
      for (let i = 1; ; i++) {
        const x = e.x + dx * i;
        const y = e.y + dy * i;
        if (!inBounds(s, x, y)) return [];
        if (tileAt(s, x, y) === 'rock' || unitAt(s, x, y) || lampAt(s, x, y)) return [[x, y]];
      }
    }
    case 'acolyte': {
      const cx = e.x + dx * 2;
      const cy = e.y + dy * 2;
      const pts: [number, number][] = [[cx, cy]];
      for (const d of DIR_LIST) pts.push([cx + DIR_VEC[d][0], cy + DIR_VEC[d][1]]);
      return pts.filter(([x, y]) => inBounds(s, x, y) && !(x === e.x && y === e.y));
    }
  }
}

/** For drawing: every tile on the thief's knife path up to and including where it lands. */
export function knifePath(s: State, e: Enemy): [number, number][] {
  const [dx, dy] = DIR_VEC[e.dir];
  const out: [number, number][] = [];
  for (let i = 1; ; i++) {
    const x = e.x + dx * i;
    const y = e.y + dy * i;
    if (!inBounds(s, x, y)) return out;
    out.push([x, y]);
    if (tileAt(s, x, y) === 'rock' || unitAt(s, x, y) || lampAt(s, x, y)) return out;
  }
}

export type StrikeEvent = {
  attacker: string;
  tiles: [number, number][];
  /** Units this strike hits. */
  hits: string[];
  lampsOut: string[];
};

/** Every surviving monster's strike, as it would land on the current board. Used for the live forecast. */
export function forecast(s: State): StrikeEvent[] {
  return enemies(s).map((e) => {
    const tiles = strikeTiles(s, e);
    const hits: string[] = [];
    const lampsOut: string[] = [];
    for (const [x, y] of tiles) {
      const u = unitAt(s, x, y);
      if (u) hits.push(u.id);
      const l = lampAt(s, x, y);
      if (l && l.lit) lampsOut.push(l.id);
    }
    return { attacker: e.id, tiles, hits, lampsOut };
  });
}

/** Every surviving monster strikes at once. Returns the end state and what each strike did, for animation. */
export function resolveStrikes(s0: State): { state: State; events: StrikeEvent[] } {
  const s = cloneState(s0);
  const events = forecast(s);
  const taken = new Map<string, string[]>();
  for (const ev of events) {
    for (const id of ev.hits) taken.set(id, [...(taken.get(id) ?? []), ev.attacker]);
    for (const id of ev.lampsOut) {
      const l = s.lamps.find((v) => v.id === id);
      if (l) l.lit = false;
    }
  }
  for (const [id, attackers] of taken) {
    const u = unitById(s, id);
    if (!u) continue;
    damage(s, u, attackers.length, `strike:${[...attackers].sort().join('+')}`);
  }
  return { state: s, events };
}

export type Outcome = {
  win: boolean;
  enemiesLeft: number;
  heroesLost: number;
  lampsOut: number;
  /** Canonical identity of the way this turn was won: which monster fell to what. */
  wayKey: string;
};

export function outcomeOf(end: State): Outcome {
  const enemiesLeft = enemies(end).length;
  const heroesLost = end.lost.length;
  const lampsOut = end.lamps.filter((l) => !l.lit).length;
  return {
    win: enemiesLeft === 0 && heroesLost === 0 && lampsOut === 0,
    enemiesLeft,
    heroesLost,
    lampsOut,
    wayKey: wayKey(end),
  };
}

export function wayKey(end: State): string {
  return end.fallen
    .map((f) => `${f.id}<${f.cause}`)
    .sort()
    .join('|');
}

/** Run a whole turn from the puzzle start: apply the actions in order, then the strikes. Null if any action is illegal. */
export function playTurn(p: Puzzle, actions: readonly Action[]): { end: State; outcome: Outcome; events: StrikeEvent[] } | null {
  let s = initialState(p);
  for (const a of actions) {
    const next = applyAction(s, a);
    if (!next) return null;
    s = next;
  }
  const { state, events } = resolveStrikes(s);
  return { end: state, outcome: outcomeOf(state), events };
}
