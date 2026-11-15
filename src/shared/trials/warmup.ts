import type { Puzzle } from '../engine/rules';

/**
 * The first-time warm-up: one idea in one move. The wolf bites the tile it faces and the boar shakes thorns on all four
 * sides. Shove the wolf one tile east and each one's strike lands on the other.
 */
export const WARMUP: Puzzle = {
  id: 'warmup',
  w: 4,
  h: 4,
  rows: ['....', '....', '....', '....'],
  heroes: [{ id: 'h1', side: 'hero', cls: 'vanguard', x: 0, y: 3, hp: 1 }],
  enemies: [
    { id: 'w1', side: 'enemy', mob: 'wolf', x: 1, y: 1, hp: 1, dir: 'E' },
    { id: 'b1', side: 'enemy', mob: 'boar', x: 3, y: 1, hp: 1, dir: 'S' },
  ],
  lamps: [],
};
