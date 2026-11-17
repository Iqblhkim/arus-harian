# 🌊 Arus Harian

Daily flow puzzle game for Reddit (Devvit Web) — built for the
**Reddit Game of the Day Hackathon 2026** ($35,000 prize pool,
deadline 9 Dec 2026 09:00 WIB).
Devpost: <https://devpost.com/software/arus-harian> ·
Play: <https://www.reddit.com/r/arus_harian_dev/>

Every day a new **7×7 current maze** is generated from the date.
An orb flows along the arrows; tap a cell to rotate its arrow 90°
clockwise (1 step). Route the orb to the 🎯 Goal with as few steps as
possible — avoid 🌀 whirlpools and arrows that flush the orb out of
the grid. Streaks, a daily top-10 leaderboard, and a shareable result
card keep players coming back tomorrow.

## How it plays

- **Start** (top-left, green ring) → **Goal** (bottom-right, amber ring).
- Tap a cell to rotate its arrow 90° clockwise. Each tap = 1 step.
- Press **▶ Alirkan Orb** to run the orb. It follows the arrows until it
  reaches the Goal, gets swallowed by a whirlpool, leaves the grid, or
  loops forever.
- **Par** is the minimum possible step count, computed exactly with
  Dijkstra (see below). Beat par, or just beat yesterday's you.
- Win the day to grow your 🔥 streak; the top 10 by fewest steps (then
  fastest time) make the leaderboard. Copy your score card and share it.

## Design decisions

- **Daily seed (UTC):** the maze is derived from the date string
  `YYYY-MM-DD` (UTC) via FNV-1a → mulberry32, so every player worldwide
  sees the same maze on the same day. A post's own date is used when the
  game is opened from a daily post (`postData.date`); otherwise today.
- **Start / Goal:** fixed corners — start `(0,0)`, goal `(6,6)`.
- **Whirlpools:** 4 per maze, random cells excluding start and goal.
  Generation retries until a geometric path exists.
- **Par range:** generation retries until par lands in **[3, 40]**
  (never trivial, never a grind); after 300 attempts the best maze
  found is kept. Verified solvable for a full year of dates (see tests).
- **Par = Dijkstra over the 49 cells:** moving from cell `u` to a
  neighbour `v` costs the clockwise rotations `u`'s arrow needs to
  point at `v` (0–3). Whirlpools are not traversable. This is exact.
- **Anti-cheat (server-side):** the server recomputes the maze from the
  date and rejects any score below par (`IMPOSSIBLE_SCORE`). Only a
  player's best score per day is kept; replays that don't improve it
  change nothing.
- **Leaderboard score:** `steps × 10¹² + timeMs` in a Redis sorted set —
  fewer steps win, faster time breaks ties.
- **Streak:** +1 on the first completion of today's maze when yesterday
  was also completed; resets to 1 otherwise. Playing an old maze counts
  toward that day's leaderboard but never touches the streak.
- **The solution is never sent to the client:** the client receives the
  maze and par (a target, like golf), never which cells to rotate.

## Stack

- **Client:** React 19 + Tailwind CSS 4 + Vite (Devvit Web, `@devvit/web` 0.15.4)
- **Server:** Hono on Devvit (`@devvit/web/server`), Redis via `@devvit/redis`
- **Shared:** pure TypeScript in `src/shared/` — FNV-1a + mulberry32 RNG,
  maze generation, Dijkstra solver, orb simulation. No platform imports.

## Project structure

```
devvit.json               manifest (name, post entrypoint, server entry,
                          permissions, moderator menu item)
src/
  shared/                 pure game logic + API contract (browser-safe)
    rng.ts                FNV-1a + mulberry32
    maze.ts               generateMaze / computePar / simulate / rotate
    types.ts              TodayResponse / SubmitScore / LeaderboardEntry
    *.test.ts             node:test unit tests
  client/                 React + Tailwind (Vite root)
    index.html  main.tsx  App.tsx  index.css
  server/
    app.ts                Hono app factory (deps injected — testable)
    store.ts              Redis keys, streak + leaderboard, anti-cheat
    index.ts              Devvit production entry (createServer + serve)
    dev.ts                local dev server (in-memory Redis, mock user)
    fake-redis.ts         in-memory RedisLike (dev + tests)
    *.test.ts             HTTP + streak tests against the fake
vite.config.ts            client build → dist/client, /api proxy in dev
scripts/dev.sh            local dev stack (API :3001 + Vite :5173)
```

## Run locally

```bash
npm install
npm run dev        # API on :3001, client on http://localhost:5173
```

The dev API uses an in-memory Redis and a mock user (`dev-pemain`), so
scores, streaks, and the leaderboard work end to end without Reddit.

Separate pieces:

```bash
npm run dev:server   # Hono API only (:3001)
npm run dev:client   # Vite client only (:5173, proxies /api → :3001)
```

## Tests & build

```bash
npm test             # unit tests (node:test) + typecheck (4 tsconfigs)
npm run test:unit    # node --test --experimental-strip-types
npm run test:types   # tsc --noEmit (client / server / shared / tests)
npm run build        # vite build (client) + esbuild (server bundle)
```

Unit tests cover: FNV-1a vectors, mulberry32 determinism, maze
determinism + solvability for 365 dates, par correctness on hand-built
mazes, orb simulation (goal / whirlpool / exit / loop), the HTTP API
(including sub-par score rejection), and streak rules across days.

## Deploy to Reddit (needs the owner's Reddit account)

The `devvit` CLI needs a Reddit login — it cannot run headless here.

```bash
npm install -g @devvit/cli
devvit login                       # browser OAuth, once
devvit playtest arus_harian_dev    # test subreddit, live preview
devvit upload                      # upload this build
devvit install r/arus_harian_dev   # install the latest version
devvit publish                     # submit for review → live
```

Then, in `r/arus_harian_dev`, a moderator uses the menu item
**"Buat Post Arus Harian"** to create each day's post. The post's
`postData.date` pins the maze to that day.

## Notes & limitations (verified, not assumed)

- `devvit playtest` / `upload` / `publish` were **not** run here — they
  require the owner's Reddit login. The production server bundle
  (`dist/server/index.cjs`) was booted locally and answered
  `GET /api/health` with Devvit metadata headers; `GET /api/day` fails
  outside the Devvit runtime only at the Redis layer
  ("Devvit config is not available"), which the runtime provides.
- The server bundle is emitted as **`.cjs`** (not `.js`) because the
  repo is `"type": "module"` (needed for `node --test` type stripping);
  a `.js` CommonJS bundle would crash with `require is not defined`.
  `devvit.json` points `server.entry` at `index.cjs` accordingly.
- `permissions` declares `redis` and `reddit` (user scope). The app
  never posts as a user — `reddit` is needed for the moderator menu
  action that creates the daily post as the app account.
- Client imports from `@devvit/web/client` need the `browser` export
  condition; `tsconfig.client.json` sets `customConditions: ["browser"]`
  for that reason.
- Logged-out players can play the maze locally; scores and streaks
  require a Reddit login.
