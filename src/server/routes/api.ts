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
import { claimChalk, flairText, loadInit, markSeen, releaseChalk, setForgePost, recordAttempt, saveForge, setNation } from '../../shared/game';
import { currentWho, kv, season, today, trialForPost } from '../core/context';
import { recordForgePost } from '../core/picks';
import { flairPost, PLAYER_FLAIR } from '../core/post';

export const api = new Hono();

const fail = (message: string): ErrorResponse => ({ type: 'error', message });

async function init(): Promise<InitResponse> {
  const { day, forge } = await trialForPost();
  const res = await loadInit(kv, season, { day, forge, today: today(), who: await currentWho(), subreddit: context.subredditName, postId: context.postId });
  // A community pick post plays the same trial as the original; the splash says it was picked.
  if (res.forge && context.postData?.pick === true) res.forge = { ...res.forge, pick: true };
  return res;
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
  const already = () => c.json<ErrorResponse>(fail('Your chalk mark is already in the thread. Find another way to leave a new one.'), 409);
  if (me.chalked >= me.ways.length) return already();
  // Claimed before posting, atomically, so two taps or two tabs cannot both post the same result.
  if (!(await claimChalk(kv, data.day, who.userId, context.postId, me.ways.length))) return already();
  const nation = me.nation ? `${NATIONS[me.nation].sigil} ${NATIONS[me.nation].short}` : '';
  const streak = me.streak > 1 && !data.forge ? ` · ${me.streak}-day streak` : '';
  // A player-built trial's title is user text, and its maker already hears about comments on their own post, so the
  // chalk mark neither quotes the title (no markdown or links from it) nor mentions the maker.
  const what = data.forge ? 'this trial' : `Foefall #${data.day} (${data.moon})`;
  const lines = [
    `**u/${me.username}** cleared ${what} on try ${me.clearTry || me.tries}${streak}${nation ? ` · ${nation}` : ''}.`,
    '',
    `Found ${me.ways.length} of ${data.community.waysTotal} ways. The subreddit has found ${data.community.ways.length}.`,
  ];
  try {
    await reddit.submitComment({ id: context.postId, text: lines.join('\n'), runAs: 'USER' });
    return c.json<OkResponse>({ type: 'ok', message: 'Chalk mark left in the comments.' });
  } catch (e) {
    console.error('chalk failed', e);
    await releaseChalk(kv, data.day, who.userId, context.postId, me.ways.length, me.chalked);
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
 * the post goes up as a new interactive post that plays the forged board. Three posts per player per day, and twelve
 * tries at posting (each runs the solver), so a client cannot make the server solve boards without limit.
 */
api.post('/forge', async (c) => {
  const who = await currentWho();
  if (!who.userId || !who.username) return c.json<ErrorResponse>(fail('Log in to forge a trial.'), 401);
  const body = await c.req.json<ForgeRequest>().catch(() => null);
  if (!body) return c.json<ErrorResponse>(fail('Missing trial.'), 400);
  const postsKey = `fw:forgequota:${today()}:${who.userId}`;
  const triesKey = `fw:forgetries:${today()}:${who.userId}`;
  if (Number((await kv.get(postsKey)) ?? 0) >= 3) return c.json<ErrorResponse>(fail('Three trials a day is the limit. Come back tomorrow.'), 429);
  const tries = await kv.incrBy(triesKey, 1);
  await kv.expire(triesKey, 2 * 86_400);
  if (tries > 12) return c.json<ErrorResponse>(fail('That is a lot of tries for one day. Come back tomorrow.'), 429);
  const verdict = verifyForge(body.puzzle, body.proof);
  if ('error' in verdict) return c.json<ErrorResponse>(fail(verdict.error), 400);
  if (!verdict.check.ok) return c.json<ErrorResponse>(fail(verdict.check.reason), 400);
  const title = cleanTitle(body.title);
  const id = await saveForge(kv, { title, author: who.username, puzzle: verdict.puzzle, wayKeys: verdict.check.wayKeys });
  try {
    const ways = verdict.check.ways;
    const post = await reddit.submitCustomPost({
      subredditName: context.subredditName,
      title: `Foefall trial by u/${who.username}: ${title || 'Untitled'} · ${ways} ${ways === 1 ? 'way' : 'ways'}`,
      entry: 'default',
      postData: { forge: id },
      runAs: 'USER',
      userGeneratedContent: { text: title || 'Untitled trial' },
      textFallback: {
        text: `A Foefall trial built by u/${who.username}. It plays inside this post. If you only see this text, update the Reddit app or open the post on reddit.com in a browser.`,
      },
    });
    await kv.set(`fw:post:${post.id}`, `forge:${id}`);
    await setForgePost(kv, id, post.id);
    await recordForgePost(post.id);
    await kv.incrBy(postsKey, 1);
    await kv.expire(postsKey, 2 * 86_400);
    await flairPost(post.id, PLAYER_FLAIR);
    return c.json<ForgeResponse>({ type: 'forge', id, postId: post.id, url: `https://reddit.com/r/${context.subredditName}/comments/${post.id.replace(/^t3_/, '')}` });
  } catch (e) {
    console.error('forge post failed', e);
    return c.json<ErrorResponse>(fail('The trial is saved, but the post could not be created.'), 500);
  }
});
