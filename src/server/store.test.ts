import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../shared/index.ts';
import { getStreak, submitScore, type UserIdentity } from './store.ts';
import { InMemoryRedis } from './fake-redis.ts';

const USER: UserIdentity = {
  userId: 't2_streaker',
  username: 'streaker',
  subredditName: 'arus_harian_dev',
};

function at(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

async function submitOn(redis: InMemoryRedis, date: string, steps?: number) {
  const par = generateMaze(date).par;
  return submitScore(
    redis,
    USER,
    { date, steps: steps ?? par + 1, timeMs: 20000 },
    at(date),
  );
}

describe('streak', () => {
  it('starts at 1, grows on consecutive days, resets after a missed day', async () => {
    const redis = new InMemoryRedis();

    const day1 = await submitOn(redis, '2026-11-17');
    assert.equal(day1.ok, true);
    assert.equal(day1.streak, 1);

    // Same day again: streak does not grow.
    const day1Again = await submitOn(redis, '2026-11-17');
    assert.equal(day1Again.streak, 1);

    // Next day: streak grows.
    const day2 = await submitOn(redis, '2026-11-18');
    assert.equal(day2.streak, 2);

    // Skip 2026-11-19, play 2026-11-20: streak resets to 1.
    const day4 = await submitOn(redis, '2026-11-20');
    assert.equal(day4.streak, 1);
  });

  it('reads as 0 when the last completion is stale', async () => {
    const redis = new InMemoryRedis();
    await submitOn(redis, '2026-11-17');
    // "Today" is 2026-11-20 and the last completion was 2026-11-17.
    assert.equal(await getStreak(redis, USER.userId ?? '', '2026-11-20'), 0);
    // But it is still alive on the next day.
    assert.equal(await getStreak(redis, USER.userId ?? '', '2026-11-18'), 1);
  });

  it('does not advance on old-maze completions', async () => {
    const redis = new InMemoryRedis();
    await submitOn(redis, '2026-11-17');
    // Play yesterday's maze today: score counts, streak does not move.
    const old = await submitScore(
      redis,
      USER,
      { date: '2026-11-17', steps: generateMaze('2026-11-17').par + 2, timeMs: 25000 },
      at('2026-11-18'),
    );
    assert.equal(old.ok, true);
    assert.equal(old.streak, 1);
    assert.equal(await getStreak(redis, USER.userId ?? '', '2026-11-18'), 1);
  });
});
