// Local preview: the real client pages, the real game logic (src/shared/game.ts) over an in-memory store, and stand-ins
// for the Devvit client SDK. Page query parameters pick the player and day: game.html?user=ana&day=4&new=1
//   user  the username (omit for a logged-out player)
//   day   which season day this "post" shows (default: today)
//   new=1 forget this player first, so the warm-up shows
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';

function mockApi(): Plugin {
  let kv: unknown = null;
  let kvFrom: unknown = null;
  return {
    name: 'forewarned-mock-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith('/api/')) return next();
        const game = (await server.ssrLoadModule(resolve('src/shared/game.ts'))) as typeof import('../src/shared/game');
        const gen = (await server.ssrLoadModule(resolve('src/shared/engine/generator.ts'))) as typeof import('../src/shared/engine/generator');
        const season = JSON.parse(readFileSync(resolve('src/server/season.json'), 'utf8'));
        // A hot-reloaded game module gets a fresh store, so old store objects never meet new code.
        if (kvFrom !== game) {
          kv = game.memoryKV();
          kvFrom = game;
        }
        const store = kv as ReturnType<typeof game.memoryKV>;
        const ref = new URL(req.headers.referer ?? 'http://x/');
        const user = ref.searchParams.get('user');
        const today = gen.dayNumber(Date.now());
        const day = Number(ref.searchParams.get('day') ?? today);
        const who = user ? { userId: `t2_${user}`, username: user, avatar: undefined } : { userId: undefined, username: undefined, avatar: undefined };
        let body: Record<string, unknown> = {};
        if (req.method === 'POST') {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          try {
            body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
          } catch {
            body = {};
          }
        }
        const send = (status: number, data: unknown) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(data));
        };
        const path = req.url.split('?')[0];
        try {
        if (path.startsWith('/api/telemetry/')) return send(200, { receipt: { status: 'LOCAL', message: 'local' } });
        if (path === '/api/init') {
          if (ref.searchParams.get('new') === '1' && who.userId) await store.hSet(`fw:u:${who.userId}`, { seen: '0' });
          return send(200, await game.loadInit(store, season, { day, today, who, subreddit: 'forewarned_dev' }));
        }
        if (path === '/api/attempt') {
          const r = await game.recordAttempt(store, season, { day, today, who, actions: body.actions as never, nowMs: Date.now() });
          return send(r.type === 'error' ? 400 : 200, r);
        }
        if (path === '/api/nation' && who.userId) {
          await game.setNation(store, who.userId, body.nation as never);
          return send(200, await game.loadInit(store, season, { day, today, who, subreddit: 'forewarned_dev' }));
        }
        if (path === '/api/seen' && who.userId) {
          await game.markSeen(store, who.userId);
          return send(200, { type: 'ok', message: 'seen' });
        }
        if (path === '/api/chalk') return send(200, { type: 'ok', message: 'Chalk mark left in the comments.' });
        if (path === '/api/subscribe') return send(200, { type: 'ok', message: 'Joined r/forewarned_dev.' });
        return send(404, { type: 'error', message: 'not found' });
        } catch (e) {
          console.error('[mock api]', e);
          return send(500, { type: 'error', message: (e as Error).message });
        }
      });
    },
  };
}

export default defineConfig({
  root: resolve('src/client'),
  plugins: [react(), mockApi()],
  resolve: {
    alias: {
      '@devvit/web/client': resolve('tools/local/devvit-client.ts'),
      '@devvit/analytics/client/reddit': resolve('tools/local/analytics.ts'),
    },
  },
  server: { host: '127.0.0.1', port: 5199, strictPort: true },
});
