import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';
import { internal } from './routes/internal';
import { telemetryRoutes } from './routes/telemetry';

const app = new Hono();

app.route('/api/telemetry', telemetryRoutes);
app.route('/api', api);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
