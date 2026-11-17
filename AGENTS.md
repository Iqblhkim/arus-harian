# AGENTS.md — Arus Harian

Instructions for agents working on this repo. The template's own rules
override general knowledge; the generated code wins over this doc.

## Stack (Devvit Web only)

- **Do NOT use Blocks or `@devvit/public-api`.** This project is Devvit
  Web only (`@devvit/web` 0.15.4, React 19 + Tailwind 4 + Hono).
- Client/server talk over plain `fetch` to `/api/*`; the contract is
  typed in `src/shared/types.ts`.
- Imports: `redis`, `reddit`, `context`, `createServer`, `getServerPort`
  from `@devvit/web/server`; `context`, `showToast`,
  `requestExpandedMode` from `@devvit/web/client`;
  `UiResponse` from `@devvit/web/shared`.
- `devvit.json` declares exactly what the app uses: `redis: true` and
  `reddit` user scope (menu action creates the daily post as the app
  account). A missing permission fails at runtime with a 500 carrying
  `x-devvit-forbidden: 1` — check `devvit.json` first, not the code.

## Layout

- `src/shared/` — pure logic, no Node/Devvit imports. It ships to the
  browser. Tests are `node:test` with `--experimental-strip-types`;
  cross-module imports use explicit `.ts` extensions and
  `allowImportingTsExtensions` is on (with `noEmit`).
- `src/server/` — Hono app built by a factory (`createApp`) that takes
  `redis`, `getContext`, and `createDailyPost` as parameters. Never
  import Devvit inside `app.ts`/`store.ts`; take clients as parameters
  so the app tests against fakes.
- `src/client/` — Vite root. The maze renders instantly from the
  deterministic local seed; leaderboard/streak load from `/api/day`
  afterwards (the inline/feed view must not block on network I/O).

## Game rules (do not break)

- Never send the solution to the client. The maze + par are public;
  which cells to rotate is not. There is intentionally no
  path-finding export in `src/shared/`.
- Par is exact Dijkstra over cells (edge cost = rotations needed).
  Anti-cheat: the server recomputes the maze from the date and rejects
  scores below par.
- Daily seed is the UTC date (`YYYY-MM-DD`) via FNV-1a → mulberry32.
- Record a commitment before scoring: only the best score per user per
  day is kept; a replay that does not improve it changes nothing.
- `postData` is client-readable — it carries only the post's date.

## Commands

- `npm run dev` — local stack (API :3001 + Vite :5173).
- `npm test` — unit tests + typecheck (must be green before deploy).
- `npm run build` — client (Vite) + server bundle (esbuild, `.cjs`).
- `devvit playtest / upload / publish` need the owner's Reddit login.

## Gotchas already handled

- Server bundle is `.cjs` because the repo is `"type": "module"`.
- Client tsconfig sets `customConditions: ["browser"]` so
  `@devvit/web/client` resolves to the browser build, not the panic stub.
- Shared test files are excluded from `tsconfig.shared.json` (shared
  must stay Node-free) and covered by `tsconfig.test.json` instead.
- `devvit upload` does not move an existing install — after uploading,
  run `devvit install r/arus_harian_dev` to bring the sub to @latest.
