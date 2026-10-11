# Contributing

## Setup
Requires Node 24+, pnpm 10 and Python 3.9+.

```sh
pnpm install
pnpm test        # all packages, plus the hook's Python tests
pnpm typecheck
pnpm e2e         # builds, then runs the browser tests
```

`pnpm --filter @fo/pwa dev` runs the dashboard against its built-in simulator (open `/?demo`).

## The golden rule
Stage inference is a pure function: the same recorded events always give the same stages. Every change to it must replay the recorded days in `fixtures/golden/` (a "golden" is a recorded day plus its expected output) and keep them passing. If a change should alter a golden, update it on purpose and review the printed sessions.

## Adding a golden
1. Pick a day to record from `~/.flowobserve/spool/`.
2. Scrub it so no real names or paths remain:
   ```sh
   pnpm --filter @fo/server scrub <in> <out> --map <your projects root>/=/Users/dev/code/
   ```
   Use absolute paths for `<in>` and `<out>`: the script runs with its working directory set to `server/`, so relative paths resolve there.
3. Check the result: `node scripts/leakcheck.mjs fixtures`
4. Generate the expected output: `pnpm --filter @fo/server golden:update`, then review the sessions it prints.

## Rules of the codebase
- The server never writes project folders.
- Bind to 127.0.0.1 only. Redact before anything touches disk.
- The hook must never slow or break Claude Code.
