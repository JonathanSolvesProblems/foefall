// A self-check that runs on Reddit after each upload to a test subreddit (the onAppUpgrade trigger). It plays a known
// winning line for today's trial as a throwaway player on a scratch day number, through the same code and the real
// Devvit Redis, and logs one line: "[selftest] ok ..." or "[selftest] FAIL ...". Scratch keys expire within the hour.
import { context, reddit, redis } from '@devvit/web/server';
import { solve } from '../../shared/engine/solver';
import { verifyForge } from '../../shared/forge';
import { loadForge, loadInit, recordAttempt, saveForge, trialFor } from '../../shared/game';
import { kv, season, today } from './context';
import { dayFlair, flairPost } from './post';

export async function selfTest(): Promise<string> {
  const t0 = Date.now();
  const day = today();
  // A far-off day that maps to the same trial (the season wraps), so its keys never touch a real day's.
  const scratch = day + season.length * 10_000;
  const s = trialFor(season, day);
  const res = solve(s.puzzle, { budget: 400_000 });
  const line = res.ways[0]?.line;
  if (!line) return `[selftest] FAIL day ${day}: solver found no line in budget`;
  const who = { userId: 't2_fwselftest', username: 'fw-selftest', avatar: undefined };
  const opts = { day: scratch, today: scratch, who, nowMs: Date.now() };
  const r = await recordAttempt(kv, season, { ...opts, actions: line });
  if (r.type !== 'attempt') return `[selftest] FAIL attempt: ${r.message}`;
  const init = await loadInit(kv, season, { day: scratch, today: scratch, who, subreddit: context.subredditName });
  const problems: string[] = [];
  if (!r.win) problems.push('replayed line did not win');
  if (init.me.tries < 1) problems.push('tries not recorded');
  if (!init.me.solved) problems.push('solve not recorded');
  if (init.me.streak < 1) problems.push('streak not started');
  if (!init.community.ways.some((w) => w.key === r.wayKey)) problems.push('way not credited');
  if (init.community.board.length < 1) problems.push('leaderboard empty');
  // Clean up the scratch day quickly; the throwaway player's own record too.
  const keys = ['stats', 'ways', 'waycount', 'nations', 'board', 'boardinfo'].map((k) => `fw:d${scratch}:${k}`);
  keys.push(`fw:d${scratch}:u:${who.userId}`, `fw:u:${who.userId}`);
  await Promise.all(keys.map((k) => redis.expire(k, 3600)));
  // Forging, minus the post: verify a small board with its proof, save it, load it back, and win it as a player.
  const board = {
    rows: ['......', '......', '......', '......', '......', '......'],
    heroes: [{ cls: 'vanguard', x: 0, y: 4 }],
    enemies: [
      { mob: 'wolf', x: 1, y: 2, dir: 'E', hp: 1 },
      { mob: 'boar', x: 3, y: 2, dir: 'S', hp: 1 },
    ],
    lamps: [],
  };
  const proof = [{ hero: 'h1', to: [0, 2] as const, target: [1, 2] as const }];
  const v = verifyForge(board, proof);
  if ('error' in v || !v.check.ok) {
    problems.push(`forge verify failed: ${'error' in v ? v.error : 'check'}`);
  } else {
    const fid = await saveForge(kv, { title: 'selftest', author: who.username, puzzle: v.puzzle, wayKeys: v.check.wayKeys });
    const forge = await loadForge(kv, fid);
    if (!forge) problems.push('forge did not load back');
    else {
      const lastBefore = await redis.hGet(`fw:u:${who.userId}`, 'last');
      const fr = await recordAttempt(kv, season, { day: -fid, today: day, who, nowMs: Date.now(), actions: proof, forge });
      const lastAfter = await redis.hGet(`fw:u:${who.userId}`, 'last');
      if (fr.type !== 'attempt' || !fr.win) problems.push('forged trial could not be won');
      else if (lastBefore !== lastAfter) problems.push('a forged trial moved the streak');
    }
    const fkeys = [`fw:forge:${fid}`, `fw:forge:${fid}:author`, ...['stats', 'ways', 'waycount', 'nations', 'board', 'boardinfo'].map((k) => `fw:d-${fid}:${k}`), `fw:d-${fid}:u:${who.userId}`];
    await Promise.all(fkeys.map((k) => redis.expire(k, 3600)));
  }

  const postId = await redis.hGet('fw:dayposts', String(day));
  let post = 'no post recorded for today';
  if (postId && postId !== 'pending') {
    try {
      // Re-apply today's flair (the same text every time) and read it back, so each upload proves post flair works.
      const want = dayFlair(day).text;
      const flaired = await flairPost(postId, dayFlair(day));
      const p = await reddit.getPostById(postId as `t3_${string}`);
      const got = p.flair?.text ?? '';
      if (!flaired) problems.push('post flair could not be set');
      else if (got !== want) problems.push(`post flair reads "${got}", expected "${want}"`);
      post = `post ${p.id} "${p.title}" flaired "${got}"`;
    } catch (e) {
      problems.push(`today's post ${postId} could not be read: ${(e as Error).message}`);
    }
  }
  // Judges must be able to open the demo post: report the community type and size on every run.
  let community: string;
  try {
    const sub = await reddit.getCurrentSubreddit();
    community = `r/${sub.name} is ${sub.type} with ${sub.numberOfSubscribers} members`;
  } catch (e) {
    community = `community type unreadable: ${(e as Error).message}`;
  }
  const ms = Date.now() - t0;
  return problems.length
    ? `[selftest] FAIL day ${day}: ${problems.join('; ')} (${ms} ms)`
    : `[selftest] ok day ${day} (${s.tier}): won way ${r.wayKey} on scratch day, ${res.ways.length} ways, forge round trip won, ${post}, ${community} (${ms} ms)`;
}
