import { type Enemy, MOBS, type MobId, type Puzzle } from './engine/rules';

export type WayPart = { victim: string; how: 'strike' | 'fall' | 'bump' | 'starfall'; by: string[] };

const SHORT: Record<MobId, string> = { wolf: 'Wolf', boar: 'Boar', thief: 'Thief', acolyte: 'Acolyte' };

/**
 * A readable name for each monster in a puzzle. A kind that appears once is just "the Boar". Two of a kind are told
 * apart by where they start ("the left Boar", "the upper Boar"); three or more by order from the left.
 */
export function monsterNames(p: Puzzle): Map<string, string> {
  const names = new Map<string, string>();
  const byKind = new Map<MobId, Enemy[]>();
  for (const e of p.enemies) byKind.set(e.mob, [...(byKind.get(e.mob) ?? []), e]);
  const ORD = ['first', 'second', 'third', 'fourth', 'fifth'];
  for (const [kind, list] of byKind) {
    const base = SHORT[kind];
    if (list.length === 1) {
      names.set(list[0]!.id, base);
    } else if (list.length === 2) {
      const [a, b] = list as [Enemy, Enemy];
      if (a.x !== b.x) {
        const [l, r] = a.x < b.x ? [a, b] : [b, a];
        names.set(l.id, `left ${base}`);
        names.set(r.id, `right ${base}`);
      } else {
        const [u, d] = a.y < b.y ? [a, b] : [b, a];
        names.set(u.id, `upper ${base}`);
        names.set(d.id, `lower ${base}`);
      }
    } else {
      const sorted = [...list].sort((a, b) => a.x - b.x || a.y - b.y);
      const words = sorted.length === 3 ? ['left', 'middle', 'right'] : sorted.map((_, i) => ORD[i] ?? `${i + 1}th`);
      sorted.forEach((e, i) => names.set(e.id, `${words[i]} ${base}`));
    }
  }
  return names;
}

/** Turn a way key (`e1<strike:e2+e3|e4<fall`) into readable parts, naming each monster as in monsterNames. */
export function wayParts(key: string, p: Puzzle): WayPart[] {
  const names = monsterNames(p);
  const name = (id: string) => names.get(id) ?? 'monster';
  return key
    .split('|')
    .filter(Boolean)
    .map((part) => {
      const [victim = '', cause = ''] = part.split('<');
      if (cause.startsWith('strike:')) {
        return { victim: name(victim), how: 'strike' as const, by: cause.slice(7).split('+').map(name) };
      }
      const how = cause === 'fall' || cause === 'bump' || cause === 'starfall' ? cause : 'strike';
      return { victim: name(victim), how, by: [] };
    });
}

/** One sentence per fallen monster, e.g. "The left Boar's thorn shake felled the Wolf". */
export function waySentences(key: string, p: Puzzle): string[] {
  const attackOf = new Map<string, string>();
  const names = monsterNames(p);
  for (const e of p.enemies) attackOf.set(names.get(e.id) ?? '', MOBS[e.mob].attack.toLowerCase());
  return wayParts(key, p).map((w) => {
    switch (w.how) {
      case 'fall':
        return `The ${w.victim} fell into the chasm`;
      case 'bump':
        return `The ${w.victim} was dashed against something hard`;
      case 'starfall':
        return `A falling star struck the ${w.victim}`;
      case 'strike': {
        const by = w.by.map((n) => `the ${n}'s ${attackOf.get(n) ?? 'strike'}`);
        const list = by.length > 1 ? `${by.slice(0, -1).join(', ')} and ${by[by.length - 1]}` : (by[0] ?? 'a strike');
        return `${list.charAt(0).toUpperCase()}${list.slice(1)} felled the ${w.victim}`;
      }
    }
  });
}
