import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import {
  type AttemptRequest,
  type ErrorResponse,
  type ForgeRequest,
  type ForgeResponse,
  type InitResponse,
  type Me,
  NATIONS,
  type NationRequest,
  NATION_LIST,
  type OkResponse,
} from '../../shared/api';
import { cleanTitle, verifyForge } from '../../shared/forge';
import { flairText, loadInit, markSeen, recordAttempt, RETENTION_SECONDS, saveForge, setNation } from '../../shared/game';
import { currentWho, kv, season, today, trialForPost } from '../core/context';

export const api = new Hono();

const fail = (message: string): ErrorResponse => ({ type: 'error', message });

async function init(): Promise<InitResponse> {
  const { day, forge } = await trialForPost();
  return loadInit(kv, season, { day, forge, today: today(), who: await currentWho(), subreddit: context.subredditName });
}

/** Keep the player's flair in step with their nation and streak. Flair is decoration: a failure never breaks play. */
async function syncFlair(me: Me): Promise<void> {
  if (!me.username || !me.nation) return;
  const n = NATIONS[me.nation];
  try {
    await reddit.setUserFlair({
      subredditName: context.subredditName,
      username: me.username,
      text: flairText(me, n.sigil, n.short),
      backgroundColor: n.color,
      textColor: 'dark',
    });
  } catch (e) {
    console.warn('flair update failed', e);
  }
}

api.get('/init', async (c) => {
  try {
    return c.json<InitResponse>(await init());
  } catch (e) {
    console.error('init failed', e);
    return c.json<ErrorResponse>(fail('Could not load today’s trial.'), 500);
  }
});

api.post('/attempt', async (c) => {
  const body = await c.req.json<AttemptRequest>().catch(() => null);
  if (!body || !Array.isArray(body.actions)) return c.json<ErrorResponse>(fail('Missing actions.'), 400);
  const { day, forge } = await trialForPost();
  const res = await recordAttempt(kv, season, {
    day,
    forge,
    today: today(),
    who: await currentWho(),
    actions: body.actions,
    nowMs: Date.now(),
  });
  if (res.type === 'error') return c.json<ErrorResponse>(res, 400);
  if (res.win && res.saved) await syncFlair(res.me);
  return c.json(res);
});

api.post('/nation', async (c) => {
  const body = await c.req.json<NationRequest>().catch(() => null);
  const who = await currentWho();
  if (!who.userId) return c.json<ErrorResponse>(fail('Log in to choose a nation.'), 401);
  if (!body || !NATION_LIST.includes(body.nation)) return c.json<ErrorResponse>(fail('Unknown nation.'), 400);
  await setNation(kv, who.userId, body.nation);
  const fresh = await init();
  await syncFlair(fresh.me);
  return c.json<InitResponse>(fresh);
});

api.post('/seen', async (c) => {
  const who = await currentWho();
  if (who.userId) await markSeen(kv, who.userId);
  return c.json<OkResponse>({ type: 'ok', message: 'seen' });
});

/**
 * Leave a chalk mark: the player's result as a comment on the day's post, from a button they press. Until the app is
 * approved, Reddit posts user-action comments from the app account for everyone but the app owner, so the text names
 * the player. The way itself is behind a spoiler tag.
 */
api.post('/chalk', async (c) => {
  const who = await currentWho();
  if (!who.userId || !context.postId) return c.json<ErrorResponse>(fail('Log in to leave a chalk mark.'), 401);
  const data = await init();
  const me = data.me;
  if (!me.solved) return c.json<ErrorResponse>(fail('Clear the trial first.'), 400);
  const nation = me.nation ? `${NATIONS[me.nation].sigil} ${NATIONS[me.nation].short}` : '';
  const streak = me.streak > 1 && !data.forge ? ` · ${me.streak}-day streak` : '';
  const what = data.forge ? `the forged trial "${data.forge.title || 'Untitled'}"` : `Forewarned #${data.day} (${data.moon})`;
  const lines = [
    `**u/${me.username}** cleared ${what} on try ${data.community.board.find((r) => r.name === me.username)?.tries ?? me.tries}${streak}${nation ? ` · ${nation}` : ''}.`,
    '',
    `Found ${me.ways.length} of ${data.community.waysTotal} ways. The subreddit has found ${data.community.ways.length}.`,
  ];
  try {
    await reddit.submitComment({ id: context.postId, text: lines.join('\n'), runAs: 'USER' });
    return c.json<OkResponse>({ type: 'ok', message: 'Chalk mark left in the comments.' });
  } catch (e) {
    console.error('chalk failed', e);
    return c.json<ErrorResponse>(fail('Could not post the comment.'), 500);
  }
});

api.post('/subscribe', async (c) => {
  const who = await currentWho();
  if (!who.userId) return c.json<ErrorResponse>(fail('Log in to join.'), 401);
  try {
    await reddit.subscribeToCurrentSubreddit();
    return c.json<OkResponse>({ type: 'ok', message: `Joined r/${context.subredditName}.` });
  } catch (e) {
    console.error('subscribe failed', e);
    return c.json<ErrorResponse>(fail('Could not join right now.'), 500);
  }
});

/**
 * Post a forged trial. The maker must have cleared it (the proof), the server re-checks the board with the solver, and
 * the post goes up as a new interactive post that plays the forged board. Three forges per player per day.
 */
api.post('/forge', async (c) => {
  const who = await currentWho();
  if (!who.userId || !who.username) return c.json<ErrorResponse>(fail('Log in to forge a trial.'), 401);
  const body = await c.req.json<ForgeRequest>().catch(() => null);
  if (!body) return c.json<ErrorResponse>(fail('Missing trial.'), 400);
  const quotaKey = `fw:forgequota:${today()}:${who.userId}`;
  const used = await kv.incrBy(quotaKey, 1);
  await kv.expire(quotaKey, 2 * 86_400);
  if (used > 3) return c.json<ErrorResponse>(fail('Three forged trials a day is the limit. Come back tomorrow.'), 429);
  const verdict = verifyForge(body.puzzle, body.proof);
  if ('error' in verdict) {
    await kv.incrBy(quotaKey, -1);
    return c.json<ErrorResponse>(fail(verdict.error), 400);
  }
  if (!verdict.check.ok) return c.json<ErrorResponse>(fail(verdict.check.reason), 400);
  const title = cleanTitle(body.title);
  const id = await saveForge(kv, { title, author: who.username, puzzle: verdict.puzzle, wayKeys: verdict.check.wayKeys });
  try {
    const ways = verdict.check.ways;
    const post = await reddit.submitCustomPost({
      subredditName: context.subredditName,
      title: `Forged trial: ${title || 'Untitled'} · ${ways} ${ways === 1 ? 'way' : 'ways'} · by u/${who.username}`,
      entry: 'default',
      postData: { forge: id },
      runAs: 'USER',
      userGeneratedContent: { text: title || 'Untitled forged trial' },
      textFallback: {
        text: `A Forewarned trial forged by u/${who.username}. It plays inside this post. If you only see this text, update the Reddit app or open the post on reddit.com in a browser.`,
      },
    });
    await kv.set(`fw:post:${post.id}`, `forge:${id}`);
    await kv.expire(`fw:forge:${id}:author`, RETENTION_SECONDS);
    return c.json<ForgeResponse>({ type: 'forge', id, postId: post.id, url: `https://reddit.com/r/${context.subredditName}/comments/${post.id.replace(/^t3_/, '')}` });
  } catch (e) {
    console.error('forge post failed', e);
    return c.json<ErrorResponse>(fail('The trial is saved, but the post could not be created.'), 500);
  }
});
