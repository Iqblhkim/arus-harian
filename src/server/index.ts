/**
 * Devvit production entrypoint.
 *
 * Wires the Hono app to the Devvit runtime: the real Redis client, the
 * request-scoped Devvit context (userId / username / subreddit), and the
 * Reddit client for the moderator menu action that creates the daily post.
 *
 * This file is the `server.entry` bundle (`dist/server/index.js`, built by
 * esbuild with `@devvit/*` externalised — the runtime provides them).
 * It is never executed locally; `src/server/dev.ts` is the local entry.
 */

import { createServer, context, getServerPort, reddit, redis } from '@devvit/web/server';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';

const app = createApp({
  redis,
  getContext: () => ({
    userId: context.userId,
    username: context.username,
    subredditName: context.subredditName,
  }),
  createDailyPost: async ({ subredditName, title, date }) => {
    const post = await reddit.submitCustomPost({
      subredditName,
      title,
      entry: 'default',
      // postData is client-readable: only the date, never secrets.
      postData: { date },
    });
    return post.id;
  },
});

serve({ fetch: app.fetch, port: getServerPort(), createServer });
