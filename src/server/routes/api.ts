import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import { type AttemptRequest, type ErrorResponse, type InitResponse, type Me, NATIONS, type NationRequest, NATION_LIST, type OkResponse } from '../../shared/api';
import { flairText, loadInit, markSeen, recordAttempt, setNation, trialFor } from '../../shared/game';
import { TIERS } from '../../shared/engine/generator';
import { currentWho, dayForPost, kv, season, today } from '../core/context';

export const api = new Hono();

const fail = (message: string): ErrorResponse => ({ type: 'error', message });

async function init(): Promise<InitResponse> {
  return loadInit(kv, season, { day: await dayForPost(), today: today(), who: await currentWho(), subreddit: context.subredditName });
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
  const res = await recordAttempt(kv, season, {
    day: await dayForPost(),
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
  const s = trialFor(season, data.day);
  const tier = TIERS[s.tier];
  const nation = me.nation ? `${NATIONS[me.nation].sigil} ${NATIONS[me.nation].short}` : '';
  const streak = me.streak > 1 ? ` · ${me.streak}-day streak` : '';
  const lines = [
    `**u/${me.username}** cleared Forewarned #${data.day} (${tier.moon}) on try ${data.community.board.find((r) => r.name === me.username)?.tries ?? me.tries}${streak}${nation ? ` · ${nation}` : ''}.`,
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
