// Devvit Journeys. The client SDK posts to /api/telemetry/journey/*; Devvit ships an Express router for these, and this
// server is Hono, so the same five endpoints are mounted here over the server telemetry client.
import { Hono } from 'hono';
import { telemetry } from '@devvit/analytics/server/reddit';

export const telemetryRoutes = new Hono();

type Body = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
const unspecified = { receipt: { status: 'JOURNEY_RECEIPT_UNSPECIFIED', message: 'Unknown: Telemetry recording status could not be confirmed.' } };

async function safe<T>(fn: () => Promise<T>): Promise<T | typeof unspecified> {
  try {
    return await fn();
  } catch (e) {
    console.warn('telemetry error', e);
    return unspecified;
  }
}

telemetryRoutes.post('/journey/start', async (c) => c.json(await safe(() => telemetry.startJourney())));

telemetryRoutes.post('/journey/app-ready', async (c) => c.json(await safe(() => telemetry.appReady())));

telemetryRoutes.post('/journey/progress', async (c) => {
  const b = (await c.req.json<Body>().catch(() => ({}))) as Body;
  const journeyId = str(b.journeyId);
  const progress = typeof b.progress === 'number' ? Math.min(1, Math.max(0, b.progress)) : undefined;
  if (!journeyId || progress === undefined) return c.json(unspecified, 400);
  return c.json(
    await safe(() =>
      telemetry.journeyProgress({ journeyId, progress, action: str(b.action) ?? '', actionDetails: str(b.actionDetails) ?? '' })
    )
  );
});

telemetryRoutes.post('/journey/interaction', async (c) => {
  const b = (await c.req.json<Body>().catch(() => ({}))) as Body;
  const action = str(b.action);
  if (!action) return c.json(unspecified, 400);
  return c.json(
    await safe(() => telemetry.journeyInteraction({ journeyId: str(b.journeyId) ?? '', action, actionDetails: str(b.actionDetails) ?? '' }))
  );
});

telemetryRoutes.post('/journey/end', async (c) => {
  const b = (await c.req.json<Body>().catch(() => ({}))) as Body;
  const journeyId = str(b.journeyId);
  if (!journeyId) return c.json(unspecified, 400);
  const g = (b.game ?? {}) as Body;
  return c.json(
    await safe(() =>
      telemetry.endJourney({
        journeyId,
        complete: b.complete === true,
        game: { win: g.win === true, score: typeof g.score === 'number' ? g.score : 0 },
      })
    )
  );
});
