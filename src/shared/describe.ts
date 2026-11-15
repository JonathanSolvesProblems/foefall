import { type Enemy, MOBS, type MobId, type Puzzle } from './engine/rules';

export type WayPart = { victim: MobId; how: 'strike' | 'fall' | 'bump' | 'starfall'; by: MobId[] };

/** Turn a way key (`e1<strike:e2+e3|e4<fall`) into readable parts, using the creature kinds from the puzzle. */
export function wayParts(key: string, p: Puzzle): WayPart[] {
  const kind = (id: string): MobId => p.enemies.find((e: Enemy) => e.id === id)?.mob ?? 'wolf';
  return key
    .split('|')
    .filter(Boolean)
    .map((part) => {
      const [victim = '', cause = ''] = part.split('<');
      if (cause.startsWith('strike:')) {
        return { victim: kind(victim), how: 'strike' as const, by: cause.slice(7).split('+').map(kind) };
      }
      const how = cause === 'fall' || cause === 'bump' || cause === 'starfall' ? cause : 'strike';
      return { victim: kind(victim), how, by: [] };
    });
}

const SHORT: Record<MobId, string> = { wolf: 'Wolf', boar: 'Boar', thief: 'Thief', acolyte: 'Acolyte' };

/** One sentence per fallen monster, e.g. "The Boar's thorns felled the Wolf". */
export function waySentences(key: string, p: Puzzle): string[] {
  return wayParts(key, p).map((w) => {
    const v = SHORT[w.victim];
    switch (w.how) {
      case 'fall':
        return `The ${v} fell into the chasm`;
      case 'bump':
        return `The ${v} was dashed against something hard`;
      case 'starfall':
        return `A falling star struck the ${v}`;
      case 'strike': {
        const by = w.by.map((m) => `the ${SHORT[m]}'s ${MOBS[m].attack.toLowerCase()}`);
        const list = by.length > 1 ? `${by.slice(0, -1).join(', ')} and ${by[by.length - 1]}` : (by[0] ?? 'a strike');
        return `${list.charAt(0).toUpperCase()}${list.slice(1)} felled the ${v}`;
      }
    }
  });
}
