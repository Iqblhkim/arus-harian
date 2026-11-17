import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRID_SIZE,
  WHIRLPOOL_COUNT,
  MIN_PAR,
  MAX_PAR,
  computePar,
  dateString,
  directionBetween,
  generateMaze,
  hasGeometricPath,
  isValidDateString,
  previousDayString,
  rotateDirection,
  rotationsNeeded,
  simulate,
  type Direction,
  type Maze,
} from './maze.ts';

/** Blank 3x3 grid of North arrows with no whirlpools. */
function blank3(): { arrows: Direction[][]; whirlpools: boolean[][] } {
  return {
    arrows: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => 0 as Direction)),
    whirlpools: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => false)),
  };
}

describe('rotateDirection / directionBetween / rotationsNeeded', () => {
  it('rotates clockwise and returns after 4 turns', () => {
    let d: Direction = 0;
    for (let i = 0; i < 4; i++) d = rotateDirection(d);
    assert.equal(d, 0);
    assert.equal(rotateDirection(0), 1);
    assert.equal(rotateDirection(3), 0);
  });

  it('finds directions between adjacent cells', () => {
    assert.equal(directionBetween({ row: 1, col: 1 }, { row: 0, col: 1 }), 0);
    assert.equal(directionBetween({ row: 1, col: 1 }, { row: 1, col: 2 }), 1);
    assert.equal(directionBetween({ row: 1, col: 1 }, { row: 2, col: 1 }), 2);
    assert.equal(directionBetween({ row: 1, col: 1 }, { row: 1, col: 0 }), 3);
    assert.equal(directionBetween({ row: 1, col: 1 }, { row: 2, col: 2 }), null);
    assert.equal(directionBetween({ row: 1, col: 1 }, { row: 1, col: 1 }), null);
  });

  it('counts clockwise rotations', () => {
    assert.equal(rotationsNeeded(0, 0), 0);
    assert.equal(rotationsNeeded(0, 1), 1);
    assert.equal(rotationsNeeded(3, 0), 1);
    assert.equal(rotationsNeeded(1, 3), 2);
    assert.equal(rotationsNeeded(0, 3), 3);
  });
});

describe('date helpers', () => {
  it('formats UTC dates as YYYY-MM-DD', () => {
    assert.equal(dateString(new Date('2026-11-17T00:00:00Z')), '2026-11-17');
    assert.equal(dateString(new Date('2026-01-05T23:59:59Z')), '2026-01-05');
  });

  it('validates date strings', () => {
    assert.equal(isValidDateString('2026-11-17'), true);
    assert.equal(isValidDateString('2026-13-01'), false);
    assert.equal(isValidDateString('2026-02-30'), false);
    assert.equal(isValidDateString('17-11-2026'), false);
    assert.equal(isValidDateString('2026-1-7'), false);
  });

  it('finds the previous UTC day across month and year boundaries', () => {
    assert.equal(previousDayString('2026-01-01'), '2025-12-31');
    assert.equal(previousDayString('2026-03-01'), '2026-02-28');
    assert.equal(previousDayString('2026-11-17'), '2026-11-16');
  });
});

describe('computePar', () => {
  it('is 0 when the orb already flows to the goal', () => {
    const { arrows, whirlpools } = blank3();
    // Path (0,0) -> (0,1) -> (1,1) -> (2,1) -> (2,2), all already pointing.
    arrows[0][0] = 1;
    arrows[0][1] = 2;
    arrows[1][1] = 2;
    arrows[2][1] = 1;
    assert.equal(
      computePar(arrows, whirlpools, { row: 0, col: 0 }, { row: 2, col: 2 }),
      0,
    );
  });

  it('counts exactly the rotations on the cheapest path', () => {
    const { arrows, whirlpools } = blank3();
    // Whirlpools fence off every detour, leaving exactly one route:
    // (0,0) -> (0,1) -> (1,1) -> (2,1) -> (2,2).
    whirlpools[1][0] = true;
    whirlpools[2][0] = true;
    whirlpools[0][2] = true;
    whirlpools[1][2] = true;
    arrows[0][0] = 1; // E, already points at (0,1): 0 rotations
    arrows[0][1] = 3; // W, needs 3 rotations to point S
    arrows[1][1] = 2; // S, already points at (2,1): 0 rotations
    arrows[2][1] = 1; // E, already points at (2,2): 0 rotations
    assert.equal(
      computePar(arrows, whirlpools, { row: 0, col: 0 }, { row: 2, col: 2 }),
      3,
    );
  });

  it('returns Infinity when whirlpools block every route', () => {
    const { arrows, whirlpools } = blank3();
    whirlpools[0][1] = true;
    whirlpools[1][0] = true;
    assert.equal(
      computePar(arrows, whirlpools, { row: 0, col: 0 }, { row: 2, col: 2 }),
      Infinity,
    );
  });
});

describe('hasGeometricPath', () => {
  it('detects open and blocked grids', () => {
    const { whirlpools } = blank3();
    assert.equal(
      hasGeometricPath(whirlpools, { row: 0, col: 0 }, { row: 2, col: 2 }, 3),
      true,
    );
    whirlpools[0][1] = true;
    whirlpools[1][0] = true;
    assert.equal(
      hasGeometricPath(whirlpools, { row: 0, col: 0 }, { row: 2, col: 2 }, 3),
      false,
    );
  });
});

describe('simulate', () => {
  it('reaches the goal along a correct arrow chain', () => {
    const { arrows, whirlpools } = blank3();
    arrows[0][0] = 1;
    arrows[0][1] = 2;
    arrows[1][1] = 2;
    arrows[2][1] = 1;
    const result = simulate(arrows, whirlpools, { row: 0, col: 0 }, { row: 2, col: 2 });
    assert.equal(result.outcome, 'goal');
    assert.deepEqual(result.path, [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 1 },
      { row: 2, col: 1 },
      { row: 2, col: 2 },
    ]);
  });

  it('fails in a whirlpool', () => {
    const { arrows, whirlpools } = blank3();
    arrows[0][0] = 1;
    whirlpools[0][1] = true;
    const result = simulate(arrows, whirlpools, { row: 0, col: 0 }, { row: 2, col: 2 });
    assert.equal(result.outcome, 'whirlpool');
    assert.deepEqual(result.path, [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
    ]);
  });

  it('fails when the arrow points out of the grid', () => {
    const { arrows, whirlpools } = blank3();
    arrows[0][0] = 0; // North from the top row
    const result = simulate(arrows, whirlpools, { row: 0, col: 0 }, { row: 2, col: 2 });
    assert.equal(result.outcome, 'exit');
    assert.deepEqual(result.path, [
      { row: 0, col: 0 },
      { row: -1, col: 0 },
    ]);
  });

  it('fails on a loop', () => {
    const { arrows, whirlpools } = blank3();
    arrows[0][0] = 1;
    arrows[0][1] = 3;
    const result = simulate(arrows, whirlpools, { row: 0, col: 0 }, { row: 2, col: 2 });
    assert.equal(result.outcome, 'loop');
    assert.deepEqual(result.path, [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 0 },
    ]);
  });
});

describe('generateMaze', () => {
  it('is deterministic: same date, same maze', () => {
    const a = generateMaze('2026-11-17');
    const b = generateMaze('2026-11-17');
    assert.deepEqual(a, b);
  });

  it('differs between dates', () => {
    const a = generateMaze('2026-11-17');
    const b = generateMaze('2026-11-18');
    assert.notDeepEqual(a.arrows, b.arrows);
  });

  it('rejects invalid dates', () => {
    assert.throws(() => generateMaze('2026-13-01'), /Invalid date string/);
  });

  it('is solvable with a sane par for a whole year of dates', () => {
    for (let day = 1; day <= 365; day++) {
      const date = new Date(Date.UTC(2026, 0, day));
      const maze = generateMaze(dateString(date));
      assert.equal(maze.size, GRID_SIZE);
      assert.deepEqual(maze.start, { row: 0, col: 0 });
      assert.deepEqual(maze.goal, { row: GRID_SIZE - 1, col: GRID_SIZE - 1 });
      assert.ok(Number.isFinite(maze.par), `par must be finite for ${maze.date}`);
      assert.ok(
        maze.par >= MIN_PAR && maze.par <= MAX_PAR,
        `par ${maze.par} out of range for ${maze.date}`,
      );
      let whirlpoolCount = 0;
      for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
          assert.ok(maze.arrows[row][col] >= 0 && maze.arrows[row][col] <= 3);
          if (maze.whirlpools[row][col]) whirlpoolCount++;
        }
      }
      assert.equal(whirlpoolCount, WHIRLPOOL_COUNT);
      assert.equal(maze.whirlpools[0][0], false);
      assert.equal(maze.whirlpools[GRID_SIZE - 1][GRID_SIZE - 1], false);
    }
  });

  it('can be solved by rotating exactly par times (greedy proof)', () => {
    // Test-only solver: repeatedly rotate the one cell that drops par by 1.
    // A single rotation can drop a cell's cost by at most 1, so par drops
    // by exactly 1 per step and the walk ends after exactly `par` steps.
    const solveByGreedy = (maze: Maze): number => {
      const arrows: Direction[][] = maze.arrows.map((row) => [...row]);
      let rotations = 0;
      for (let guard = 0; guard < 100; guard++) {
        const flow = simulate(arrows, maze.whirlpools, maze.start, maze.goal);
        if (flow.outcome === 'goal') return rotations;
        const currentPar = computePar(arrows, maze.whirlpools, maze.start, maze.goal);
        let progressed = false;
        for (let row = 0; row < GRID_SIZE && !progressed; row++) {
          for (let col = 0; col < GRID_SIZE && !progressed; col++) {
            if (maze.whirlpools[row][col]) continue;
            const trial: Direction[][] = arrows.map((r) => [...r]);
            trial[row][col] = rotateDirection(trial[row][col]);
            const nextPar = computePar(trial, maze.whirlpools, maze.start, maze.goal);
            if (nextPar === currentPar - 1) {
              arrows[row][col] = trial[row][col];
              rotations++;
              progressed = true;
            }
          }
        }
        assert.ok(progressed, `greedy solver stuck on ${maze.date}`);
      }
      throw new Error(`greedy solver did not finish for ${maze.date}`);
    };

    for (const date of ['2026-11-17', '2026-11-18', '2026-12-09', '2027-01-01', '2026-06-15']) {
      const maze = generateMaze(date);
      const rotations = solveByGreedy(maze);
      assert.equal(rotations, maze.par, `greedy rotations must equal par for ${date}`);
    }
  });
});
