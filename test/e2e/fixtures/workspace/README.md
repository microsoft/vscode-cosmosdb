# E2E test workspace fixture

This directory is the **source-of-truth workspace** that every Playwright
worker opens in VS Code. The fixture (`test/e2e/fixtures/vscode.ts`)
copies it into a worker-scoped temp dir before launch — tests must never
write into this checked-in directory.

## What lives here

| File                    | Purpose                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `sample.nosql`          | Example NoSQL query against the seeded `products` container — used by smoke specs. |
| `.vscode/settings.json` | Workspace-scoped overrides (kept minimal — most settings live in user-data dir).   |

## Adding new fixtures

1. Drop the file in here (e.g. a migration JSON, another `.nosql` query, etc.).
2. Reference it from your spec via `path.join(workspaceDir, 'your-file.ext')`.

The fixture is copied (not mounted), so a spec that mutates a file only
affects its own worker.

## What's in the emulator

The seed script (`scripts/import-seed.mjs`) populates database
`nosql-test-db` with three containers:

- `products` — flat e-commerce catalogue (~200 docs)
- `orders` — nested objects + line-item arrays (~150 docs)
- `events` — sparse time-series (~200 docs)

All seeded against the e2e emulator at `https://localhost:8082` with the
well-known emulator key. See `test/e2e/setup/emulator.ts` for the exact
endpoint / key constants.
