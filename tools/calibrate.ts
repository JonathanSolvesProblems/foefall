// Generate a few trials per tier with the difficulty filters loosened, and print how long each took and how many ways and
// what win ratio each had, so the tier bands in generator.ts are set from data.
import { generateTrial, TIERS, type TierId } from '../src/shared/engine/generator';
import { makeRng } from '../src/shared/engine/rng';

const only = process.argv[2] as TierId | undefined;
const per = Number(process.argv[3] ?? 6);
for (const id of Object.keys(TIERS) as TierId[]) {
  if (only && id !== only) continue;
  const loose = { ...TIERS[id], ways: [1, 99] as const, maxWinRatio: 1 };
  const rows: string[] = [];
  const t0 = Date.now();
  for (let i = 0; i < per; i++) {
    const s = Date.now();
    const g = generateTrial(makeRng(1000 + i * 7919 + id.length * 31), loose, `${id}-${i}`, 300);
    const ms = Date.now() - s;
    rows.push(g ? `ways=${g.ways} ratio=${g.winRatio.toFixed(4)} leaves=${g.leaves} enemies=${g.puzzle.enemies.length} ${ms}ms` : `none ${ms}ms`);
  }
  console.log(`== ${id} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  for (const r of rows) console.log('  ' + r);
}
