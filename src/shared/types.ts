/**
 * API contract shared by the Devvit server and the web client.
 * Keep this module free of Node and Devvit imports — it ships to the browser.
 */

import type { Maze } from './maze.ts';

export type { Maze, Pos, Direction, FlowOutcome, SimulationResult } from './maze.ts';

export interface LeaderboardEntry {
  rank: number;
  username: string;
  steps: number;
  /** Milliseconds from first tap to the winning flow. Lower is better. */
  timeMs: number;
}

export interface MyBest {
  steps: number;
  timeMs: number;
  rank: number;
}

export interface TodayResponse {
  date: string;
  maze: Maze;
  leaderboard: LeaderboardEntry[];
  /** Current daily streak for the requesting user (0 when logged out). */
  myStreak: number;
  /** The requesting user's best score today, if they have one. */
  myBest: MyBest | null;
  loggedIn: boolean;
}

export interface SubmitScoreRequest {
  /** Date of the maze being scored, YYYY-MM-DD (must be today). */
  date: string;
  /** Rotations (taps) the player used. Must be >= par. */
  steps: number;
  /** Milliseconds from first tap to the winning flow. */
  timeMs: number;
}

export interface SubmitScoreResponse {
  ok: boolean;
  streak: number;
  /** Rank on today's leaderboard after this submission (null if unranked). */
  rank: number | null;
  best: { steps: number; timeMs: number };
  /** True when this submission improved the player's best for today. */
  improved: boolean;
  error?: string;
}

export interface ApiError {
  ok: false;
  error: string;
}
