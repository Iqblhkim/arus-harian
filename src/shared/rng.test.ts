import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fnv1a, mulberry32, nextInt } from './rng.ts';

describe('fnv1a', () => {
  it('matches known FNV-1a 32-bit vectors', () => {
    assert.equal(fnv1a(''), 2166136261);
    assert.equal(fnv1a('a'), 3826002220);
    assert.equal(fnv1a('hello'), 1335831723);
    assert.equal(fnv1a('2026-11-17'), 1864097727);
    assert.equal(fnv1a('2026-11-18'), 1947985822);
  });

  it('is deterministic and sensitive to input', () => {
    assert.equal(fnv1a('2026-11-17'), fnv1a('2026-11-17'));
    assert.notEqual(fnv1a('2026-11-17'), fnv1a('2026-11-18'));
    assert.ok(fnv1a('x') >= 0 && fnv1a('x') <= 0xffffffff);
  });
});

describe('mulberry32', () => {
  it('produces the same stream for the same seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 20; i++) {
      assert.equal(a(), b());
    }
  });

  it('produces different streams for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let differs = false;
    for (let i = 0; i < 20; i++) {
      if (a() !== b()) differs = true;
    }
    assert.ok(differs);
  });

  it('stays in [0, 1)', () => {
    const rng = mulberry32(999);
    for (let i = 0; i < 1000; i++) {
      const value = rng();
      assert.ok(value >= 0 && value < 1);
    }
  });
});

describe('nextInt', () => {
  it('stays in [0, max)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const value = nextInt(rng, 4);
      assert.ok(value >= 0 && value < 4);
    }
  });
});
