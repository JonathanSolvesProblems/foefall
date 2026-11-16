import { Hono } from 'hono';
import type { TriggerResponse, UiResponse } from '@devvit/web/shared';
import { context, redis } from '@devvit/web/server';
import { forgetForge } from '../../shared/game';
import { kv, today } from '../core/context';
import { forgetChalkThread } from '../core/chalkthread';
import { forgetForgePost, postCommunityPick } from '../core/picks';
import { postDay } from '../core/post';
import { selfTest } from '../core/selftest';

export const internal = new Hono();

const link = (id: string) => `https://reddit.com/r/${context.subredditName}/comments/${id.replace(/^t3_/, '')}`;

/** Daily at 00:01 UTC: post the new day's trial. */
internal.post('/scheduler/daily-trial', async (c) => {
  try {
    const r = await postDay();
    console.log(`daily trial ${r.created ? 'posted' : 'already up'}: ${r.id}`);
  } catch (e) {
    console.error('daily trial failed', e);
  }
  // Sundays: the week's best-liked player-built trial goes up again as the community pick.
  try {
    const p = await postCommunityPick(today());
    if (p.reason !== 'not Sunday') console.log(`community pick: ${p.reason}${p.id ? ` ${p.id}` : ''}`);
  } catch (e) {
    console.error('community pick failed', e);
  }
  return c.json({}, 200);
});

internal.post('/triggers/on-app-install', async (c) => {
  try {
    const r = await postDay();
    return c.json<TriggerResponse>({ status: 'success', message: `Trial posted: ${r.id}` }, 200);
  } catch (e) {
    console.error('install post failed', e);
    return c.json<TriggerResponse>({ status: 'error', message: 'Failed to post the first trial' }, 400);
  }
});

internal.post('/triggers/on-app-upgrade', async (c) => {
  try {
    await postDay();
  } catch (e) {
    console.error('upgrade post failed', e);
  }
  // Test subreddits only: prove the game works end to end on Reddit's own Redis after every upload.
  if (context.subredditName.toLowerCase().endsWith('_dev')) {
    try {
      console.log(await selfTest());
    } catch (e) {
      console.error('[selftest] FAIL threw', e);
    }
  }
  return c.json<TriggerResponse>({ status: 'success', message: 'ok' }, 200);
});

/** Devvit Rules: when a post is deleted, delete what the app stored about it. */
internal.post('/triggers/on-post-delete', async (c) => {
  try {
    const body = await c.req.json<{ postId?: string; post?: { id?: string } }>().catch(() => ({}) as { postId?: string; post?: { id?: string } });
    const postId = body.postId ?? body.post?.id;
    if (postId) {
      const mapped = await redis.get(`fw:post:${postId}`);
      await redis.del(`fw:post:${postId}`);
      await forgetForgePost(postId);
      await forgetChalkThread(postId);
      // A player-built trial is its maker's content: deleting the post it first went up in deletes it.
      const forgeId = Number(mapped?.replace(/^forge:/, ''));
      const trialGone = mapped?.startsWith('forge:') && forgeId > 0 ? await forgetForge(kv, forgeId, postId) : false;
      if (mapped && !mapped.startsWith('forge:') && (await redis.hGet('fw:dayposts', mapped)) === postId) await redis.hDel('fw:dayposts', [mapped]);
      console.log(`post ${postId} deleted; mapping ${mapped ?? '?'} removed${trialGone ? ', player trial deleted' : ''}`);
    }
  } catch (e) {
    console.error('post delete cleanup failed', e);
  }
  return c.json<TriggerResponse>({ status: 'success', message: 'ok' }, 200);
});

internal.post('/menu/post-today', async (c) => {
  try {
    const r = await postDay();
    if (!r.id) return c.json<UiResponse>({ showToast: 'Today’s trial is being posted right now. Look again in a minute.' }, 200);
    return c.json<UiResponse>(
      r.created ? { navigateTo: link(r.id) } : { showToast: 'Today’s trial is already posted.', navigateTo: link(r.id) },
      200
    );
  } catch (e) {
    console.error('menu post failed', e);
    return c.json<UiResponse>({ showToast: 'Could not post today’s trial.' }, 400);
  }
});

/** Post the community pick now, from this week's player-built trials, without waiting for Sunday. */
internal.post('/menu/post-pick', async (c) => {
  try {
    const r = await postCommunityPick(today(), { force: true });
    return c.json<UiResponse>(r.id ? { navigateTo: link(r.id) } : { showToast: r.reason }, 200);
  } catch (e) {
    console.error('pick post failed', e);
    return c.json<UiResponse>({ showToast: 'Could not post the community pick.' }, 400);
  }
});

/** For playtesting: post today's trial again even if one exists. */
internal.post('/menu/post-fresh', async (c) => {
  try {
    const r = await postDay(undefined, true);
    return c.json<UiResponse>({ navigateTo: link(r.id) }, 200);
  } catch (e) {
    console.error('fresh post failed', e);
    return c.json<UiResponse>({ showToast: 'Could not post.' }, 400);
  }
});
