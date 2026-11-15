import { useCallback, useMemo, useState } from 'react';
import {
  abilityTargets,
  type Action,
  applyAction,
  cloneState,
  forecast,
  type Hero,
  initialState,
  outcomeOf,
  type Puzzle,
  reachable,
  resolveStrikes,
  type State,
} from '../../shared/engine/rules';

type XY = readonly [number, number];
const same = (a: XY, x: number, y: number) => a[0] === x && a[1] === y;

/** The board with a hero standing on a tile it has not committed to yet. */
function withMove(s: State, heroId: string, to: XY): State {
  const n = cloneState(s);
  const h = n.units.find((u) => u.id === heroId);
  if (h) {
    h.x = to[0];
    h.y = to[1];
  }
  return n;
}

export function useTrial(puzzle: Puzzle) {
  const base = useMemo(() => initialState(puzzle), [puzzle]);
  const [actions, setActions] = useState<Action[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<XY | null>(null);

  const committed = useMemo(() => actions.reduce<State>((s, a) => applyAction(s, a) ?? s, base), [base, actions]);
  const display = useMemo(
    () => (selected && pending ? withMove(committed, selected, pending) : committed),
    [committed, selected, pending]
  );
  const strikes = useMemo(() => forecast(display), [display]);
  const predicted = useMemo(() => resolveStrikes(display).state, [display]);
  const outcome = useMemo(() => outcomeOf(predicted), [predicted]);

  const doomed = useMemo(() => {
    const already = new Set(display.fallen.map((f) => f.id));
    return new Set(predicted.fallen.map((f) => f.id).filter((id) => !already.has(id)));
  }, [display, predicted]);
  const danger = useMemo(() => {
    const d = new Set<string>();
    for (const ev of strikes) {
      for (const id of ev.hits) if (display.units.find((u) => u.id === id)?.side === 'hero') d.add(id);
      for (const id of ev.lampsOut) d.add(id);
    }
    return d;
  }, [strikes, display]);

  const heroNow = (s: State, id: string | null): Hero | undefined =>
    id ? s.units.find((u): u is Hero => u.id === id && u.side === 'hero') : undefined;

  const selHero = heroNow(committed, selected);
  const canAct = !!selHero && !committed.acted.includes(selHero.id);
  const moveTiles = useMemo<XY[]>(() => (canAct && selHero ? reachable(committed, selHero) : []), [canAct, selHero, committed]);
  const targetTiles = useMemo<XY[]>(() => {
    const h = heroNow(display, selected);
    return canAct && h ? abilityTargets(display, h) : [];
  }, [canAct, display, selected]);

  const pendingHeroes = useMemo(
    () => committed.units.filter((u): u is Hero => u.side === 'hero' && !committed.acted.includes(u.id)),
    [committed]
  );

  const commit = useCallback(
    (a: Action) => {
      const next = applyAction(committed, a);
      if (!next) return false;
      setActions((xs) => [...xs, a]);
      setPending(null);
      const nextHero = next.units.find((u) => u.side === 'hero' && !next.acted.includes(u.id));
      setSelected(nextHero?.id ?? null);
      return true;
    },
    [committed]
  );

  /** Tap a tile: select a hero, choose where it walks, or use its ability on a ringed target. */
  const tap = useCallback(
    (x: number, y: number): 'select' | 'move' | 'act' | 'wait' | 'none' => {
      const unit = display.units.find((u) => u.x === x && u.y === y);
      if (selHero && canAct) {
        const at: XY = pending ?? [selHero.x, selHero.y];
        if (targetTiles.some((t) => same(t, x, y))) {
          return commit({ hero: selHero.id, to: at, target: [x, y] }) ? 'act' : 'none';
        }
        if (unit?.id === selHero.id) {
          // After walking, tapping your hero again ends its turn there. Before walking it does nothing, because a first
          // tap on your own hero means "this one", not "skip my turn".
          if (!pending) return 'select';
          return commit({ hero: selHero.id, to: at, target: null }) ? 'wait' : 'none';
        }
        if (moveTiles.some((t) => same(t, x, y))) {
          setPending(same([selHero.x, selHero.y], x, y) ? null : [x, y]);
          return 'move';
        }
      }
      if (unit?.side === 'hero' && !committed.acted.includes(unit.id)) {
        setSelected(unit.id);
        setPending(null);
        return 'select';
      }
      setPending(null);
      return 'none';
    },
    [display, selHero, canAct, pending, targetTiles, moveTiles, commit, committed]
  );

  const wait = useCallback(() => {
    if (!selHero || !canAct) return;
    commit({ hero: selHero.id, to: pending ?? [selHero.x, selHero.y], target: null });
  }, [selHero, canAct, pending, commit]);

  const undo = useCallback(() => {
    if (pending) {
      setPending(null);
      return;
    }
    const last = actions[actions.length - 1];
    if (!last) return;
    setActions(actions.slice(0, -1));
    setSelected(last.hero);
  }, [pending, actions]);

  const reset = useCallback(() => {
    setActions([]);
    setPending(null);
    setSelected(puzzle.heroes[0]?.id ?? null);
  }, [puzzle]);

  return {
    base,
    actions,
    committed,
    display,
    strikes,
    predicted,
    outcome,
    doomed,
    danger,
    selected,
    setSelected,
    pending,
    moveTiles,
    targetTiles,
    pendingHeroes,
    tap,
    wait,
    undo,
    reset,
  };
}
