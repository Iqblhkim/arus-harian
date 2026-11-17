/**
 * Local dev server — runs the same Hono app as production, but with an
 * in-memory Redis fake and a mock logged-in user, on plain Node.
 *
 * Run with `npm run dev:server` (port 3001 by default). The Vite dev
 * server (`npm run dev:client`) proxies `/api` to this server.
 */

import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { InMemoryRedis } from './fake-redis.ts';

const port = Number(process.env.PORT ?? 3001);
const redis = new InMemoryRedis();

const app = createApp({
  redis,
  getContext: () => ({
    userId: 't2_devuser',
    username: 'dev-pemain',
    subredditName: 'arus_harian_dev',
  }),
  createDailyPost: async ({ subredditName, title, date }) => {
    console.log(`[dev] createDailyPost: r/${subredditName} "${title}" (${date})`);
    return 't3_devpost';
  },
});

serve({ fetch: app.fetch, port });
console.log(`Arus Harian dev API on http://localhost:${port}`);
