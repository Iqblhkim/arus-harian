import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, todayString } from '../shared/index.ts';
import { createApp, type AppDeps } from './app.ts';
import { InMemoryRedis } from './fake-redis.ts';

function makeDeps(redis: InMemoryRedis, userId = 't2_user1', username = 'pemain-satu'): AppDeps {
  return {
    redis,
    getContext: () => ({ userId, username, subredditName: 'arus_harian_dev' }),
    createDailyPost: async () => 't3_abc123',
  };
}

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const app = createApp(makeDeps(new InMemoryRedis()));
    const res = await app.request('/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

describe('GET /api/day', () => {
  it('returns today maze, empty leaderboard and zero streak for a fresh user', async () => {
    const app = createApp(makeDeps(new InMemoryRedis()));
    const res = await app.request('/api/day');
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      date: string;
      maze: { par: number };
      leaderboard: unknown[];
      myStreak: number;
      myBest: unknown;
      loggedIn: boolean;
    };
    assert.equal(body.date, todayString());
    assert.equal(body.maze.par, generateMaze(todayString()).par);
    assert.deepEqual(body.leaderboard, []);
    assert.equal(body.myStreak, 0);
    assert.equal(body.myBest, null);
    assert.equal(body.loggedIn, true);
  });

  it('rejects future dates', async () => {
    const app = createApp(makeDeps(new InMemoryRedis()));
    const res = await app.request('/api/day?date=2999-01-01');
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'INVALID_DATE');
  });

  it('works logged out (read-only)', async () => {
    const deps = makeDeps(new InMemoryRedis());
    deps.getContext = () => ({ userId: undefined, username: undefined, subredditName: 'x' });
    const app = createApp(deps);
    const res = await app.request('/api/day');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { loggedIn: boolean };
    assert.equal(body.loggedIn, false);
  });
});

describe('POST /api/score (anti-cheat)', () => {
  it('rejects a sub-par score', async () => {
    const app = createApp(makeDeps(new InMemoryRedis()));
    const par = generateMaze(todayString()).par;
    const res = await app.request('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: todayString(), steps: par - 1, timeMs: 30000 }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.match(body.error, /IMPOSSIBLE_SCORE/);
  });

  it('rejects invalid time and malformed JSON', async () => {
    const app = createApp(makeDeps(new InMemoryRedis()));
    const par = generateMaze(todayString()).par;
    const tooFast = await app.request('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: todayString(), steps: par, timeMs: 500 }),
    });
    assert.equal(tooFast.status, 400);
    const badJson = await app.request('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    assert.equal(badJson.status, 400);
  });

  it('requires login', async () => {
    const deps = makeDeps(new InMemoryRedis());
    deps.getContext = () => ({ userId: undefined, username: undefined, subredditName: 'x' });
    const app = createApp(deps);
    const res = await app.request('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: todayString(), steps: 10, timeMs: 30000 }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'LOGIN_REQUIRED');
  });

  it('accepts a valid score, keeps the best, and ranks by steps then time', async () => {
    const redis = new InMemoryRedis();
    const par = generateMaze(todayString()).par;
    const app1 = createApp(makeDeps(redis, 't2_user1', 'pemain-satu'));
    const app2 = createApp(makeDeps(redis, 't2_user2', 'pemain-dua'));

    const submit = async (
      app: ReturnType<typeof createApp>,
      steps: number,
      timeMs: number,
    ) =>
      app.request('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: todayString(), steps, timeMs }),
      });

    // User 1: par + 5 steps.
    const first = await submit(app1, par + 5, 60000);
    assert.equal(first.status, 200);
    const firstBody = (await first.json()) as {
      ok: boolean;
      streak: number;
      rank: number;
      improved: boolean;
    };
    assert.equal(firstBody.ok, true);
    assert.equal(firstBody.streak, 1);
    assert.equal(firstBody.rank, 1);
    assert.equal(firstBody.improved, true);

    // User 1 again, worse: not an improvement, best unchanged.
    const worse = await submit(app1, par + 8, 10000);
    const worseBody = (await worse.json()) as {
      ok: boolean;
      improved: boolean;
      best: { steps: number };
      streak: number;
    };
    assert.equal(worseBody.ok, true);
    assert.equal(worseBody.improved, false);
    assert.equal(worseBody.best.steps, par + 5);
    assert.equal(worseBody.streak, 1);

    // User 1 again, better: improvement recorded.
    const better = await submit(app1, par + 2, 45000);
    const betterBody = (await better.json()) as { improved: boolean; best: { steps: number } };
    assert.equal(betterBody.improved, true);
    assert.equal(betterBody.best.steps, par + 2);

    // User 2 with fewer steps than user 1's best -> ranks first.
    const user2 = await submit(app2, par + 1, 30000);
    const user2Body = (await user2.json()) as { rank: number };
    assert.equal(user2Body.rank, 1);

    const day = await app1.request('/api/day');
    const dayBody = (await day.json()) as {
      leaderboard: { rank: number; username: string; steps: number }[];
      myBest: { steps: number; rank: number };
    };
    assert.equal(dayBody.leaderboard.length, 2);
    assert.equal(dayBody.leaderboard[0].username, 'pemain-dua');
    assert.equal(dayBody.leaderboard[0].steps, par + 1);
    assert.equal(dayBody.leaderboard[1].username, 'pemain-satu');
    assert.equal(dayBody.myBest.steps, par + 2);
    assert.equal(dayBody.myBest.rank, 2);
  });
});

describe('menu create-post', () => {
  it('creates the daily post and returns a UiResponse', async () => {
    const app = createApp(makeDeps(new InMemoryRedis()));
    const res = await app.request('/internal/menu/create-post', { method: 'POST' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { showToast: string };
    assert.match(body.showToast, /Arus Harian/);
  });
});
