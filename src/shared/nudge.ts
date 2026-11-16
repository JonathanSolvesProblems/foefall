// A nudge for a stuck player: the opening move of one way to win, shown on the board. It points at a way the player has
// not won yet, so it helps the hunt as well as a first clear. Runs the solver, so call it from a button, not per tap.
import { monsterNames } from './describe';
import { CLASSES, type Hero, initialState, type Puzzle } from './engine/rules';
import { solve } from './engine/solver';

export type Nudge = {
  hero: string;
  from: readonly [number, number];
  to: readonly [number, number];
  target: readonly [number, number] | null;
  text: string;
};

export function findNudge(p: Puzzle, myWays: readonly string[]): Nudge | null {
  // One more way than the player has found is enough to be sure one of them is new to them.
  const res = solve(p, { stopAtWays: myWays.length + 1 });
  const way = res.ways.find((w) => !myWays.includes(w.key)) ?? res.ways[0];
  const a = way?.line[0];
  if (!a) return null;
  const h = p.heroes.find((u): u is Hero => u.id === a.hero);
  if (!h) return null;
  const c = CLASSES[h.cls];
  const moves = a.to[0] !== h.x || a.to[1] !== h.y;
  // Name the target, since the board also rings every other target the hero could reach.
  const t = a.target ? initialState(p).units.find((u) => u.x === a.target![0] && u.y === a.target![1]) : undefined;
  const whom = !t ? 'the marked target' : t.side === 'enemy' ? `the ${monsterNames(p).get(t.id) ?? 'monster'}` : `the ${CLASSES[t.cls].name}`;
  const text = moves
    ? a.target
      ? `First step: walk the ${c.name} to the gold square, then use ${c.ability} on ${whom}.`
      : `First step: walk the ${c.name} to the gold square and stay there.`
    : a.target
      ? `First step: the ${c.name} stays put and uses ${c.ability} on ${whom}.`
      : `First step: the ${c.name} waits where it stands.`;
  return { hero: h.id, from: [h.x, h.y], to: a.to, target: a.target, text };
}
