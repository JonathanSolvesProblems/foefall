import { describe, expect, it } from 'vitest';
import { checkForge, cleanTitle, normalizeForge, verifyForge } from './forge';

const rows = ['......', '......', '......', '......', '......', '......'];
// The warm-up idea on a 6 x 6 board: shove the wolf one tile east into the boar.
const board = {
  rows,
  heroes: [{ cls: 'vanguard', x: 0, y: 4 }],
  enemies: [
    { mob: 'wolf', x: 1, y: 2, dir: 'E', hp: 1 },
    { mob: 'boar', x: 3, y: 2, dir: 'S', hp: 1 },
  ],
  lamps: [],
};
const proof = [{ hero: 'h1', to: [0, 2], target: [1, 2] }];

describe('forged trials', () => {
  it('normalises input: fresh ids, one piece per tile, known kinds only', () => {
    const p = normalizeForge(board);
    expect(p?.heroes[0]).toMatchObject({ id: 'h1', cls: 'vanguard', hp: 1 });
    expect(p?.enemies.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(normalizeForge({ ...board, enemies: [...board.enemies, { mob: 'dragon', x: 5, y: 5, dir: 'N' }] })).toBeNull();
    expect(normalizeForge({ ...board, lamps: [{ x: 1, y: 2 }] })).toBeNull();
    expect(normalizeForge({ ...board, rows: [...rows.slice(0, 5), '..X...'] })).toBeNull();
  });

  it('accepts a winnable board with a winning proof, and counts its ways', () => {
    const r = verifyForge(board, proof);
    expect('error' in r).toBe(false);
    if ('check' in r) expect(r.check.ok && r.check.ways).toBeGreaterThanOrEqual(1);
  });

  it('refuses a proof that does not win, and a board already won by doing nothing', () => {
    expect(verifyForge(board, [])).toEqual({ error: 'The proof turn does not win. Clear your own trial first.' });
    const solved = { ...board, enemies: [{ mob: 'wolf', x: 2, y: 2, dir: 'E' }, { mob: 'boar', x: 3, y: 2, dir: 'S' }] };
    const r = verifyForge(solved, []);
    expect(r).toEqual({ error: 'It is already won if nobody moves. Make the monsters miss each other first.' });
  });

  it('enforces the piece limits before solving', () => {
    const p = normalizeForge({ ...board, heroes: [] });
    expect(p && checkForge(p)).toEqual({ ok: false, reason: 'Place at least one hero.' });
    const twins = normalizeForge({ ...board, heroes: [{ cls: 'vanguard', x: 0, y: 4 }, { cls: 'vanguard', x: 5, y: 5 }] });
    expect(twins && checkForge(twins)).toEqual({ ok: false, reason: 'Each hero must be a different class.' });
  });

  it('keeps titles to one short line', () => {
    expect(cleanTitle('  The\n\tlong   night  ')).toBe('The long night');
    expect(cleanTitle('x'.repeat(80)).length).toBe(40);
    expect(cleanTitle(42)).toBe('');
  });
});
