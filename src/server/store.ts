/**
 * Server-side storage for Arus Harian.
 *
 * The storage layer is written against a narrow `RedisLike` interface and
 * takes the client as a parameter — never imports Devvit directly. That
 * lets the Hono app run against a plain in-memory fake in tests and local
 * dev, and against the real Devvit Redis in production. An SDK signature
 * change then breaks the build at this one seam.
 *
 * Keys (all prefixed `arus-harian:`):
 * - `lb:{date}`        sorted set, member = userId, score = steps * 1e12 + timeMs
 *                       (lower is better: fewer steps, then faster time)
 * - `lb:{date}:meta`   hash, field = userId -> JSON { username, steps, timeMs, at }
 * - `streak:{userId}`  string JSON { count, lastDate }
 *
 * Leaderboard keys expire after 3 days; streaks persist (a stale streak
 * simply reads as 0 until the player returns).
 */

import {
  generateMaze,
  isValidDateString,
  previousDayString,
  todayString,
} from '../shared/index.ts';
import type {
  LeaderboardEntry,
  MyBest,
  SubmitScoreResponse,
  TodayResponse,
} from '../shared/index.ts';

export interface UserIdentity {
  userId: string | undefined;
  username: string | undefined;
  subredditName: string;
}

/** Narrow Redis surface the store needs (subset of @devvit/redis). */
export interface RedisLike {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  zAdd(key: string, ...members: { member: string; score: number }[]): Promise<unknown>;
  zRange(
    key: string,
    start: number,
    stop: number,
    options: { by: 'rank'; reverse?: boolean },
  ): Promise<{ member: string; score: number }[]>;
  hSet(key: string, fieldValues: Record<string, string>): Promise<unknown>;
  hGet(key: string, field: string): Promise<string | undefined>;
  hGetAll(key: string): Promise<Record<string, string>>;
}

export const MAX_STEPS = 1000;
export const MIN_TIME_MS = 1000;
export const MAX_TIME_MS = 3_600_000;
const SCORE_TIME_MULTIPLIER = 1e12;
const LEADERBOARD_TTL_SECONDS = 3 * 24 * 3600;
const LEADERBOARD_SIZE = 10;

const leaderboardKey = (date: string): string => `arus-harian:lb:${date}`;
const leaderboardMetaKey = (date: string): string => `arus-harian:lb:${date}:meta`;
const streakKey = (userId: string): string => `arus-harian:streak:${userId}`;

/** Composite score: steps dominate, time breaks ties. */
export function encodeScore(steps: number, timeMs: number): number {
  const clampedTime = Math.min(Math.max(Math.floor(timeMs), 0), SCORE_TIME_MULTIPLIER - 1);
  return steps * SCORE_TIME_MULTIPLIER + clampedTime;
}

export function decodeScore(score: number): { steps: number; timeMs: number } {
  return {
    steps: Math.floor(score / SCORE_TIME_MULTIPLIER),
    timeMs: score % SCORE_TIME_MULTIPLIER,
  };
}

interface StreakRecord {
  count: number;
  lastDate: string;
}

interface BestMeta {
  username: string;
  steps: number;
  timeMs: number;
  at: string;
}

function parseStreak(raw: string | undefined): StreakRecord | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as StreakRecord).count === 'number' &&
      typeof (value as StreakRecord).lastDate === 'string'
    ) {
      return value as StreakRecord;
    }
    return null;
  } catch {
    return null;
  }
}

function parseBestMeta(raw: string | undefined): BestMeta | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as BestMeta).steps === 'number' &&
      typeof (value as BestMeta).timeMs === 'number'
    ) {
      return value as BestMeta;
    }
    return null;
  } catch {
    return null;
  }
}

/** Rank (1-based) of a user inside a day's leaderboard, or null. */
async function findRank(redis: RedisLike, date: string, userId: string): Promise<number | null> {
  const members = await redis.zRange(leaderboardKey(date), 0, -1, { by: 'rank' });
  const index = members.findIndex((entry) => entry.member === userId);
  return index === -1 ? null : index + 1;
}

export async function getLeaderboard(
  redis: RedisLike,
  date: string,
): Promise<LeaderboardEntry[]> {
  const members = await redis.zRange(leaderboardKey(date), 0, LEADERBOARD_SIZE - 1, {
    by: 'rank',
  });
  const meta = await redis.hGetAll(leaderboardMetaKey(date));
  const entries: LeaderboardEntry[] = [];
  for (let i = 0; i < members.length; i++) {
    const parsed = parseBestMeta(meta[members[i].member]);
    if (!parsed) continue;
    entries.push({
      rank: i + 1,
      username: parsed.username,
      steps: parsed.steps,
      timeMs: parsed.timeMs,
    });
  }
  return entries;
}

export async function getStreak(redis: RedisLike, userId: string, today: string): Promise<number> {
  const record = parseStreak(await redis.get(streakKey(userId)));
  if (!record) return 0;
  // A streak is alive only when the last completion was today or yesterday.
  if (record.lastDate === today || record.lastDate === previousDayString(today)) {
    return record.count;
  }
  return 0;
}

export async function getTodayData(
  redis: RedisLike,
  user: UserIdentity,
  date: string,
): Promise<TodayResponse> {
  const today = todayString();
  const maze = generateMaze(date);
  const leaderboard = await getLeaderboard(redis, date);
  let myStreak = 0;
  let myBest: MyBest | null = null;
  if (user.userId) {
    myStreak = await getStreak(redis, user.userId, today);
    const best = parseBestMeta(
      await redis.hGet(leaderboardMetaKey(date), user.userId),
    );
    if (best) {
      myBest = {
        steps: best.steps,
        timeMs: best.timeMs,
        rank: (await findRank(redis, date, user.userId)) ?? 0,
      };
    }
  }
  return {
    date,
    maze,
    leaderboard,
    myStreak,
    myBest,
    loggedIn: user.userId !== undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Validate and record a score.
 *
 * Anti-cheat: the maze for the submitted date is recomputed server-side
 * and any score below par is rejected — a sub-par step count is
 * impossible, so it can only come from a tampered client. The stored
 * best is only ever improved, never worsened.
 */
export async function submitScore(
  redis: RedisLike,
  user: UserIdentity,
  body: unknown,
  now: Date = new Date(),
): Promise<SubmitScoreResponse> {
  const today = todayString(now);
  const fail = (error: string): SubmitScoreResponse => ({
    ok: false,
    streak: 0,
    rank: null,
    best: { steps: 0, timeMs: 0 },
    improved: false,
    error,
  });

  if (!user.userId) return fail('LOGIN_REQUIRED');
  if (!isRecord(body)) return fail('INVALID_BODY');

  const { date, steps, timeMs } = body as Record<string, unknown>;
  if (typeof date !== 'string' || !isValidDateString(date) || date > today) {
    return fail('INVALID_DATE');
  }
  if (!isInteger(steps) || steps < 1 || steps > MAX_STEPS) return fail('INVALID_STEPS');
  if (!isInteger(timeMs) || timeMs < MIN_TIME_MS || timeMs > MAX_TIME_MS) {
    return fail('INVALID_TIME');
  }

  const maze = generateMaze(date);
  if (steps < maze.par) {
    return fail(`IMPOSSIBLE_SCORE: par hari ini ${maze.par} langkah.`);
  }

  const username = user.username ?? 'pemain';
  const newScore = encodeScore(steps, timeMs);
  const metaKey = leaderboardMetaKey(date);
  const existing = parseBestMeta(await redis.hGet(metaKey, user.userId));
  const improved = !existing || newScore < encodeScore(existing.steps, existing.timeMs);

  if (improved) {
    await redis.zAdd(leaderboardKey(date), { member: user.userId, score: newScore });
    await redis.hSet(metaKey, {
      [user.userId]: JSON.stringify({
        username,
        steps,
        timeMs,
        at: now.toISOString(),
      } satisfies BestMeta),
    });
    await redis.expire(leaderboardKey(date), LEADERBOARD_TTL_SECONDS);
    await redis.expire(metaKey, LEADERBOARD_TTL_SECONDS);
  }

  // Streak only advances on first completion of TODAY's maze.
  let streak = await getStreak(redis, user.userId, today);
  if (date === today) {
    const record = parseStreak(await redis.get(streakKey(user.userId)));
    if (!record || record.lastDate !== date) {
      const nextCount =
        record && record.lastDate === previousDayString(date) ? record.count + 1 : 1;
      await redis.set(streakKey(user.userId), JSON.stringify({ count: nextCount, lastDate: date } satisfies StreakRecord));
      streak = nextCount;
    }
  }

  const rank = await findRank(redis, date, user.userId);
  const best = improved
    ? { steps, timeMs }
    : { steps: existing?.steps ?? steps, timeMs: existing?.timeMs ?? timeMs };
  return { ok: true, streak, rank, best, improved };
}
