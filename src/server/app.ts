/**
 * Hono app for Arus Harian.
 *
 * The app is built by a factory that takes its dependencies as parameters
 * (Redis client, request context, post creator) so it can run against
 * fakes in tests and local dev — no Devvit imports in this file.
 *
 * Routes:
 * - GET  /api/health          liveness probe
 * - GET  /api/day?date=...    maze + leaderboard + streak for a day
 *                              (defaults to today; future dates rejected)
 * - POST /api/score           submit a score (server-side anti-cheat)
 * - ALL  /internal/menu/create-post  moderator menu action: creates the
 *                              daily post in the subreddit
 */

import { Hono } from 'hono';
import { isValidDateString, todayString } from '../shared/index.ts';
import {
  getTodayData,
  submitScore,
  type RedisLike,
  type UserIdentity,
} from './store.ts';

export interface AppDeps {
  redis: RedisLike;
  /** Request-scoped identity (Devvit context in production). */
  getContext: () => UserIdentity;
  /**
   * Creates the daily post. Returns the new post's id.
   * Only invoked from the moderator menu action.
   */
  createDailyPost: (opts: {
    subredditName: string;
    title: string;
    date: string;
  }) => Promise<string>;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/day', async (c) => {
    const requested = c.req.query('date');
    const today = todayString();
    const date = requested ?? today;
    if (!isValidDateString(date) || date > today) {
      return c.json({ ok: false, error: 'INVALID_DATE' }, 400);
    }
    try {
      const data = await getTodayData(deps.redis, deps.getContext(), date);
      return c.json(data);
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error('GET /api/day failed:', detail, error);
      return c.json({ ok: false, error: 'INTERNAL_ERROR', detail }, 500);
    }
  });

  app.post('/api/score', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    }
    try {
      const result = await submitScore(deps.redis, deps.getContext(), body);
      return c.json(result, result.ok ? 200 : 400);
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error('POST /api/score failed:', detail, error);
      return c.json({ ok: false, error: 'INTERNAL_ERROR', detail }, 500);
    }
  });

  // Menu items invoke the endpoint with POST in production; accept GET too
  // so the action can be probed from a browser during development.
  app.on(['GET', 'POST'], '/internal/menu/create-post', async (c) => {
    const ctx = deps.getContext();
    const today = todayString();
    try {
      const postId = await deps.createDailyPost({
        subredditName: ctx.subredditName,
        title: `🌊 Arus Harian — ${today}`,
        date: today,
      });
      console.info('Daily post created:', postId);
      return c.json({
        showToast: `Post Arus Harian untuk ${today} sudah dibuat!`,
        navigateTo: { url: `/comments/${postId}` },
      });
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error('create-post failed:', detail, error);
      return c.json({ showToast: `Gagal membuat post: ${detail}` }, 500);
    }
  });

  return app;
}
