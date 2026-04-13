# RPC Refactor Notes: Channel → tRPC

## Context

The extension communicates between the VS Code extension host (server) and webview panels (client) via RPC. The old transport was a **channel-based** approach; the new one uses **tRPC**.

The goal: everything should work exactly as before the refactor.

## Query Editor: Run & Reload Flow

### Expected Behavior (old & new)

1. **Run query** — user clicks Run with e.g. `SELECT * FROM c`
2. **Save to history** — the query is saved to persistent history (`updateQueryHistory`). History uses `unshift`, so the **newest item is at index 0**.
3. **Reload** — the Reload button re-runs **the most recent history entry** (`state.queryHistory[0]`), which should be the same query the user just ran.

### Key Details

- `persistQueryHistory()` in `queryEditorRouter.ts` uses `queryHistory.unshift(query)` — newest first.
- `updateQueryHistory` must be **awaited** (blocking) in `QueryEditorContextProvider.runQuery()` — matching the old channel-based behavior where `await this.sendCommand('updateQueryHistory', query)` guaranteed history was updated before the query ran.
- History is persisted per container: `{databaseId}/{containerId}`.
- History max size: `QUERY_HISTORY_SIZE = 10`.

### Bugs Fixed (April 2026)

1. **`ReloadQueryButton` used wrong index**: `state.queryHistory[state.queryHistory.length - 1]` picked the **oldest** entry instead of `state.queryHistory[0]` (newest). This was a latent bug masked when history had only one distinct entry.
2. **`updateQueryHistory` was fire-and-forget**: Changed from `void ... .then(...)` to `await` to match the old sequential `sendCommand` behavior and prevent race conditions.
