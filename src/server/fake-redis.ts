/**
 * In-memory fake of the narrow Redis surface in `store.ts`.
 * Used by the local dev server and by the server unit tests.
 * Not imported by the production entrypoint, so it never ships to Devvit.
 */

import type { RedisLike } from './store.ts';

export class InMemoryRedis implements RedisLike {
  private strings = new Map<string, string>();
  private sortedSets = new Map<string, Map<string, number>>();
  private hashes = new Map<string, Map<string, string>>();

  async get(key: string): Promise<string | undefined> {
    return this.strings.get(key);
  }

  async set(key: string, value: string): Promise<string> {
    this.strings.set(key, value);
    return 'OK';
  }

  async expire(_key: string, _seconds: number): Promise<number> {
    return 1;
  }

  async zAdd(
    key: string,
    ...members: { member: string; score: number }[]
  ): Promise<number> {
    let set = this.sortedSets.get(key);
    if (!set) {
      set = new Map();
      this.sortedSets.set(key, set);
    }
    let added = 0;
    for (const { member, score } of members) {
      if (!set.has(member)) added++;
      set.set(member, score);
    }
    return added;
  }

  async zRange(
    key: string,
    start: number,
    stop: number,
    options: { by: 'rank'; reverse?: boolean },
  ): Promise<{ member: string; score: number }[]> {
    void options;
    const set = this.sortedSets.get(key);
    if (!set) return [];
    const sorted = [...set.entries()]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score);
    const end = stop === -1 ? sorted.length : stop + 1;
    return sorted.slice(start, end);
  }

  async hSet(key: string, fieldValues: Record<string, string>): Promise<number> {
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map();
      this.hashes.set(key, hash);
    }
    let added = 0;
    for (const [field, value] of Object.entries(fieldValues)) {
      if (!hash.has(field)) added++;
      hash.set(field, value);
    }
    return added;
  }

  async hGet(key: string, field: string): Promise<string | undefined> {
    return this.hashes.get(key)?.get(field);
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    const hash = this.hashes.get(key);
    return hash ? Object.fromEntries(hash) : {};
  }

  /** Test helper: wipe all stored data. */
  clear(): void {
    this.strings.clear();
    this.sortedSets.clear();
    this.hashes.clear();
  }
}
