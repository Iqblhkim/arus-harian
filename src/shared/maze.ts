/**
 * Core maze logic for Arus Harian — pure functions, no platform imports.
 *
 * The game: a 7x7 grid. Every cell holds a flow arrow (N/E/S/W). An orb
 * starts at the top-left cell and follows the arrows. The player taps a
 * cell to rotate its arrow 90° clockwise; each tap costs 1 step. The goal
 * is to route the orb into the bottom-right cell (Goal) using as few steps
 * as possible. Whirlpool cells swallow the orb; arrows that point out of
 * the grid flush it away; a loop never arrives.
 *
 * `par` (the minimum possible step count) is computed with Dijkstra over
 * the 49 cells: moving from cell u to a neighbour v costs the number of
 * clockwise rotations u's arrow needs to point at v (0–3). Whirlpools are
 * not traversable. This is exact, not an estimate.
 */

import { fnv1a, mulberry32, nextInt } from './rng.ts';

export const GRID_SIZE = 7;
/** How many whirlpool cells each daily maze has. */
export const WHIRLPOOL_COUNT = 4;
/** Target par range for a daily maze: never trivial, never a grind. */
export const MIN_PAR = 3;
export const MAX_PAR = 40;
/** Max generation attempts before accepting the best maze found. */
export const MAX_GENERATION_ATTEMPTS = 300;

/** 0 = North (up), 1 = East (right), 2 = South (down), 3 = West (left). */
export type Direction = 0 | 1 | 2 | 3;

export const DIRECTION_ARROWS: Record<Direction, string> = {
  0: '↑',
  1: '→',
  2: '↓',
  3: '←',
};

/** Row/col delta for each direction, indexed by Direction. */
export const DIRECTION_DELTAS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], // N
  [0, 1], // E
  [1, 0], // S
  [0, -1], // W
];

export interface Pos {
  row: number;
  col: number;
}

export interface Maze {
  /** Date the maze belongs to, YYYY-MM-DD (UTC). */
  date: string;
  size: number;
  start: Pos;
  goal: Pos;
  /** arrows[row][col]: flow direction of that cell. */
  arrows: Direction[][];
  /** whirlpools[row][col]: true when the cell swallows the orb. */
  whirlpools: boolean[][];
  /** Minimum number of rotations needed to route the orb to the goal. */
  par: number;
}

export type FlowOutcome = 'goal' | 'whirlpool' | 'exit' | 'loop';

export interface SimulationResult {
  outcome: FlowOutcome;
  /** Cells the orb visited, in order. For 'exit' the last entry is the
   * off-grid coordinate the orb slid to (row or col outside 0..6). */
  path: Pos[];
}

export function rotateDirection(direction: Direction): Direction {
  return ((direction + 1) % 4) as Direction;
}

/** Direction from `from` to an orthogonally adjacent `to`, or null. */
export function directionBetween(from: Pos, to: Pos): Direction | null {
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  if (dr === -1 && dc === 0) return 0;
  if (dr === 0 && dc === 1) return 1;
  if (dr === 1 && dc === 0) return 2;
  if (dr === 0 && dc === -1) return 3;
  return null;
}

/** Clockwise rotations (0–3) needed to turn `from` into `to`. */
export function rotationsNeeded(from: Direction, to: Direction): number {
  return (to - from + 4) % 4;
}

export function isInside(pos: Pos, size: number): boolean {
  return pos.row >= 0 && pos.row < size && pos.col >= 0 && pos.col < size;
}

/** YYYY-MM-DD in UTC. The daily seed uses UTC so every player worldwide
 * shares the same maze on the same day. */
export function dateString(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayString(now: Date = new Date()): string {
  return dateString(now);
}

export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && dateString(date) === value;
}

/** Date string of the UTC day before `date`. */
export function previousDayString(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return dateString(d);
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

function allCells(size: number): Pos[] {
  const cells: Pos[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      cells.push({ row, col });
    }
  }
  return cells;
}

function samePos(a: Pos, b: Pos): boolean {
  return a.row === b.row && a.col === b.col;
}

/** True when a path of orthogonal steps from start to goal exists that
 * never enters a whirlpool cell. Arrows are ignored — only geometry. */
export function hasGeometricPath(
  whirlpools: boolean[][],
  start: Pos,
  goal: Pos,
  size: number,
): boolean {
  const seen = new Set<string>([`${start.row},${start.col}`]);
  const queue: Pos[] = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (samePos(current, goal)) return true;
    for (const [dr, dc] of DIRECTION_DELTAS) {
      const next: Pos = { row: current.row + dr, col: current.col + dc };
      if (!isInside(next, size)) continue;
      if (whirlpools[next.row][next.col]) continue;
      const key = `${next.row},${next.col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return false;
}

/**
 * Minimum rotations (par) to route the orb from start to goal.
 * Dijkstra over cells: traversing from cell u to neighbour v costs the
 * rotations u's arrow needs to point at v. The goal cell's arrow is
 * irrelevant (arriving wins), and whirlpools cannot be entered.
 * Returns Infinity when the goal is unreachable.
 */
export function computePar(
  arrows: Direction[][],
  whirlpools: boolean[][],
  start: Pos,
  goal: Pos,
): number {
  const size = arrows.length;
  const dist: number[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => Infinity),
  );
  dist[start.row][start.col] = 0;
  // Tiny graph (49 nodes): a plain array used as a priority queue is fine.
  const queue: Array<{ pos: Pos; cost: number }> = [{ pos: start, cost: 0 }];
  while (queue.length > 0) {
    let bestIndex = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].cost < queue[bestIndex].cost) bestIndex = i;
    }
    const current = queue.splice(bestIndex, 1)[0];
    if (current.cost > dist[current.pos.row][current.pos.col]) continue;
    if (samePos(current.pos, goal)) return current.cost;
    for (const [dr, dc] of DIRECTION_DELTAS) {
      const next: Pos = { row: current.pos.row + dr, col: current.pos.col + dc };
      if (!isInside(next, size)) continue;
      if (whirlpools[next.row][next.col]) continue;
      const needed = directionBetween(current.pos, next);
      if (needed === null) continue;
      const stepCost = rotationsNeeded(arrows[current.pos.row][current.pos.col], needed);
      const nextCost = current.cost + stepCost;
      if (nextCost < dist[next.row][next.col]) {
        dist[next.row][next.col] = nextCost;
        queue.push({ pos: next, cost: nextCost });
      }
    }
  }
  return dist[goal.row][goal.col];
}

/**
 * Follow the arrows from the start cell until the orb reaches the goal,
 * is swallowed by a whirlpool, leaves the grid, or repeats a cell (loop).
 */
export function simulate(
  arrows: Direction[][],
  whirlpools: boolean[][],
  start: Pos,
  goal: Pos,
): SimulationResult {
  const size = arrows.length;
  const path: Pos[] = [{ ...start }];
  const visited = new Set<string>([`${start.row},${start.col}`]);
  let current: Pos = { ...start };
  // 49 cells + margin: more steps than this means a loop was missed.
  for (let step = 0; step < size * size + 2; step++) {
    if (samePos(current, goal)) return { outcome: 'goal', path };
    if (whirlpools[current.row][current.col]) return { outcome: 'whirlpool', path };
    const [dr, dc] = DIRECTION_DELTAS[arrows[current.row][current.col]];
    const next: Pos = { row: current.row + dr, col: current.col + dc };
    if (!isInside(next, size)) {
      path.push(next);
      return { outcome: 'exit', path };
    }
    const key = `${next.row},${next.col}`;
    if (visited.has(key)) {
      path.push(next);
      return { outcome: 'loop', path };
    }
    visited.add(key);
    path.push(next);
    current = next;
  }
  return { outcome: 'loop', path };
}

/**
 * Generate the deterministic daily maze for a date (YYYY-MM-DD).
 * Same date → same maze, on every device. The maze is guaranteed
 * solvable: geometric connectivity is enforced and par is computed, with
 * regeneration until par lands in [MIN_PAR, MAX_PAR] (or the best maze
 * found after MAX_GENERATION_ATTEMPTS is kept as a fallback).
 */
export function generateMaze(date: string): Maze {
  if (!isValidDateString(date)) {
    throw new Error(`Invalid date string (expected YYYY-MM-DD): ${date}`);
  }
  const size = GRID_SIZE;
  const start: Pos = { row: 0, col: 0 };
  const goal: Pos = { row: size - 1, col: size - 1 };
  const rng = mulberry32(fnv1a(date));

  let bestMaze: Maze | null = null;

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const arrows: Direction[][] = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => nextInt(rng, 4) as Direction),
    );

    // Whirlpools: random cells, never start or goal, always connected.
    let whirlpools: boolean[][] = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => false),
    );
    let placed = false;
    for (let shuffleAttempt = 0; shuffleAttempt < 50 && !placed; shuffleAttempt++) {
      const candidates = shuffle(
        allCells(size).filter((cell) => !samePos(cell, start) && !samePos(cell, goal)),
        rng,
      );
      const grid: boolean[][] = Array.from({ length: size }, () =>
        Array.from({ length: size }, () => false),
      );
      for (let i = 0; i < WHIRLPOOL_COUNT; i++) {
        grid[candidates[i].row][candidates[i].col] = true;
      }
      if (hasGeometricPath(grid, start, goal, size)) {
        whirlpools = grid;
        placed = true;
      }
    }
    if (!placed) continue;

    const par = computePar(arrows, whirlpools, start, goal);
    const maze: Maze = { date, size, start, goal, arrows, whirlpools, par };
    if (!bestMaze || Math.abs(par - 12) < Math.abs(bestMaze.par - 12)) {
      bestMaze = maze;
    }
    if (par >= MIN_PAR && par <= MAX_PAR) return maze;
  }

  if (!bestMaze) {
    throw new Error(`Could not generate a solvable maze for ${date}`);
  }
  return bestMaze;
}
