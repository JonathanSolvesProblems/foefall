import { Hono } from 'hono';
import type { TriggerResponse, UiResponse } from '@devvit/web/shared';
import { context, redis } from '@devvit/web/server';
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
      const day = await redis.get(`fw:post:${postId}`);
      await redis.del(`fw:post:${postId}`);
      if (day && (await redis.hGet('fw:dayposts', day)) === postId) await redis.hDel('fw:dayposts', [day]);
      console.log(`post ${postId} deleted; mapping for day ${day ?? '?'} removed`);
    }
  } catch (e) {
    console.error('post delete cleanup failed', e);
  }
  return c.json<TriggerResponse>({ status: 'success', message: 'ok' }, 200);
});

internal.post('/menu/post-today', async (c) => {
  try {
    const r = await postDay();
    return c.json<UiResponse>(
      r.created ? { navigateTo: link(r.id) } : { showToast: 'Today’s trial is already posted.', navigateTo: link(r.id) },
      200
    );
  } catch (e) {
    console.error('menu post failed', e);
    return c.json<UiResponse>({ showToast: 'Could not post today’s trial.' }, 400);
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
