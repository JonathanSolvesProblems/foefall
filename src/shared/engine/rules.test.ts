import { describe, expect, it } from 'vitest';
import { applyAction, initialState, playTurn, type Puzzle, resolveStrikes, unitById } from './rules';
import { solve } from './solver';
import { WARMUP } from '../trials/warmup';

const board = (rows: string[], rest: Partial<Puzzle>): Puzzle => ({
  id: 't',
  w: rows[0]!.length,
  h: rows.length,
  rows,
  heroes: [],
  enemies: [],
  lamps: [],
  ...rest,
});

describe('warm-up trial', () => {
  it('is lost if the player does nothing', () => {
    const r = playTurn(WARMUP, []);
    expect(r?.outcome.win).toBe(false);
  });

  it('is won by shoving the wolf into the boar', () => {
    const r = playTurn(WARMUP, [{ hero: 'h1', to: [0, 1], target: [1, 1] }]);
    expect(r?.outcome.win).toBe(true);
    expect(r?.outcome.wayKey).toBe('b1<strike:w1|w1<strike:b1');
  });

  it('has exactly one way, found by the solver', () => {
    const res = solve(WARMUP);
    expect(res.trivial).toBe(false);
    expect(res.truncated).toBe(false);
    expect(res.ways.map((w) => w.key)).toEqual(['b1<strike:w1|w1<strike:b1']);
  });
});

describe('strikes land at the same moment', () => {
  it('two wolves facing each other fell each other', () => {
    const p = board(['....'], {
      enemies: [
        { id: 'a', side: 'enemy', mob: 'wolf', x: 1, y: 0, hp: 1, dir: 'E' },
        { id: 'b', side: 'enemy', mob: 'wolf', x: 2, y: 0, hp: 1, dir: 'W' },
      ],
    });
    const { state } = resolveStrikes(initialState(p));
    expect(state.fallen.map((f) => f.id).sort()).toEqual(['a', 'b']);
  });

  it('a thief knife stops at the first thing in its path', () => {
    const p = board(['......'], {
      enemies: [
        { id: 't', side: 'enemy', mob: 'thief', x: 0, y: 0, hp: 1, dir: 'E' },
        { id: 'w', side: 'enemy', mob: 'wolf', x: 3, y: 0, hp: 1, dir: 'E' },
        { id: 'v', side: 'enemy', mob: 'wolf', x: 5, y: 0, hp: 1, dir: 'E' },
      ],
    });
    const { state } = resolveStrikes(initialState(p));
    expect(state.fallen.map((f) => f.id)).toEqual(['w']);
  });

  it('an acolyte calls a cross two tiles ahead, and a lit lamp in it goes out', () => {
    const p = board(['.....', '.....', '.....', '.....', '.....'], {
      enemies: [{ id: 'c', side: 'enemy', mob: 'acolyte', x: 2, y: 4, hp: 1, dir: 'N' }],
      lamps: [{ id: 'l', x: 3, y: 2, lit: true }],
    });
    const { state, events } = resolveStrikes(initialState(p));
    expect(events[0]!.tiles.map(([x, y]) => `${x},${y}`).sort()).toEqual(['1,2', '2,1', '2,2', '2,3', '3,2']);
    expect(state.lamps[0]!.lit).toBe(false);
  });

  it('an elite with 2 health survives one strike and falls to two', () => {
    const p = board(['.....'], {
      enemies: [
        { id: 'a', side: 'enemy', mob: 'wolf', x: 1, y: 0, hp: 1, dir: 'E' },
        { id: 'e', side: 'enemy', mob: 'boar', x: 2, y: 0, hp: 2, dir: 'N' },
        { id: 'b', side: 'enemy', mob: 'wolf', x: 3, y: 0, hp: 1, dir: 'W' },
      ],
    });
    const { state } = resolveStrikes(initialState(p));
    expect(state.fallen.find((f) => f.id === 'e')?.cause).toBe('strike:a+b');
  });
});

describe('hero abilities', () => {
  it('a shove into rock bumps for 1 and the creature stays put', () => {
    const p = board(['.', '.', '#'], {
      heroes: [{ id: 'h', side: 'hero', cls: 'vanguard', x: 0, y: 0, hp: 2 }],
      enemies: [{ id: 'r', side: 'enemy', mob: 'wolf', x: 0, y: 1, hp: 2, dir: 'N' }],
    });
    const after = applyAction(initialState(p), { hero: 'h', to: [0, 0], target: [0, 1] });
    expect(unitById(after!, 'r')).toMatchObject({ x: 0, y: 1, hp: 1 });
  });

  it('a shove onto a chasm drops the creature, and a shove off the board edge does nothing', () => {
    const p = board(['..~'], {
      heroes: [{ id: 'h', side: 'hero', cls: 'vanguard', x: 0, y: 0, hp: 2 }],
      enemies: [{ id: 'r', side: 'enemy', mob: 'wolf', x: 1, y: 0, hp: 1, dir: 'N' }],
    });
    const fell = applyAction(initialState(p), { hero: 'h', to: [0, 0], target: [1, 0] });
    expect(fell!.fallen.map((f) => ({ id: f.id, cause: f.cause }))).toEqual([{ id: 'r', cause: 'fall' }]);
    const p2 = board(['..'], {
      heroes: [{ id: 'h', side: 'hero', cls: 'vanguard', x: 0, y: 0, hp: 2 }],
      enemies: [{ id: 'r', side: 'enemy', mob: 'wolf', x: 1, y: 0, hp: 1, dir: 'N' }],
    });
    const edge = applyAction(initialState(p2), { hero: 'h', to: [0, 0], target: [1, 0] });
    expect(unitById(edge!, 'r')).toMatchObject({ x: 1, y: 0, hp: 1 });
  });

  it('two creatures shoved together both take 1', () => {
    const p = board(['....'], {
      heroes: [{ id: 'h', side: 'hero', cls: 'vanguard', x: 0, y: 0, hp: 2 }],
      enemies: [
        { id: 'a', side: 'enemy', mob: 'wolf', x: 1, y: 0, hp: 1, dir: 'N' },
        { id: 'b', side: 'enemy', mob: 'boar', x: 2, y: 0, hp: 2, dir: 'N' },
      ],
    });
    const after = applyAction(initialState(p), { hero: 'h', to: [0, 0], target: [1, 0] });
    expect(after!.fallen.map((f) => ({ id: f.id, cause: f.cause }))).toEqual([{ id: 'a', cause: 'bump' }]);
    expect(unitById(after!, 'b')).toMatchObject({ hp: 1 });
  });

  it('a reaver hurls a creature over its head into a chasm', () => {
    const p = board(['~..'], {
      heroes: [{ id: 'h', side: 'hero', cls: 'reaver', x: 1, y: 0, hp: 2 }],
      enemies: [{ id: 'w', side: 'enemy', mob: 'wolf', x: 2, y: 0, hp: 1, dir: 'W' }],
    });
    const after = applyAction(initialState(p), { hero: 'h', to: [1, 0], target: [2, 0] });
    expect(after!.fallen.map((f) => ({ id: f.id, cause: f.cause }))).toEqual([{ id: 'w', cause: 'fall' }]);
  });

  it('a gloamhunter drags a creature across a chasm, and it falls', () => {
    const p = board(['.~..'], {
      heroes: [{ id: 'h', side: 'hero', cls: 'gloamhunter', x: 0, y: 0, hp: 2 }],
      enemies: [{ id: 'w', side: 'enemy', mob: 'wolf', x: 3, y: 0, hp: 1, dir: 'W' }],
    });
    const after = applyAction(initialState(p), { hero: 'h', to: [0, 0], target: [3, 0] });
    expect(after!.fallen.map((f) => ({ id: f.id, cause: f.cause }))).toEqual([{ id: 'w', cause: 'fall' }]);
  });

  it('a hexweaver swaps places, and a shardcaller drops a star 2 or 3 tiles away', () => {
    const p = board(['....'], {
      heroes: [
        { id: 'x', side: 'hero', cls: 'hexweaver', x: 0, y: 0, hp: 2 },
        { id: 's', side: 'hero', cls: 'shardcaller', x: 3, y: 0, hp: 2 },
      ],
      enemies: [{ id: 'w', side: 'enemy', mob: 'wolf', x: 2, y: 0, hp: 1, dir: 'W' }],
    });
    const swapped = applyAction(initialState(p), { hero: 'x', to: [0, 0], target: [2, 0] });
    expect(unitById(swapped!, 'w')).toMatchObject({ x: 0, y: 0 });
    expect(unitById(swapped!, 'x')).toMatchObject({ x: 2, y: 0 });
    const starred = applyAction(swapped!, { hero: 's', to: [3, 0], target: [0, 0] });
    expect(starred!.fallen.map((f) => ({ id: f.id, cause: f.cause }))).toEqual([{ id: 'w', cause: 'starfall' }]);
  });

  it('rejects a move the hero cannot reach and a target it cannot hit', () => {
    const p = board(['......'], {
      heroes: [{ id: 'h', side: 'hero', cls: 'shardcaller', x: 0, y: 0, hp: 2 }],
      enemies: [{ id: 'w', side: 'enemy', mob: 'wolf', x: 1, y: 0, hp: 1, dir: 'W' }],
    });
    expect(applyAction(initialState(p), { hero: 'h', to: [5, 0], target: null })).toBeNull();
    expect(applyAction(initialState(p), { hero: 'h', to: [0, 0], target: [1, 0] })).toBeNull();
  });
});
