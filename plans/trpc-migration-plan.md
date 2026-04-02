# Plan: Migrate Legacy Channel/Transport to Unified tRPC Communication

Incrementally replace the string-keyed `Channel`/`Transport` messaging system with Zod-validated tRPC routers, subscriptions, and typed event sinks across 5 phases. Each phase is independently shippable and testable, with the legacy Channel coexisting until final cleanup in Phase 4.

---

## Phase 0: Infrastructure (Foundation Layer) ✅ COMPLETED

### Step 1. Create `TypedEventSink<T>` utility

- **Create** `src/utils/TypedEventSink.ts` — an `AsyncIterable<T>` class with `emit(event: T)`, `close()`, and `[Symbol.asyncIterator]()`. Internally uses a queue + resolver pattern to bridge imperative `emit()` calls into async generator consumption by tRPC subscriptions.
- **Create** `src/utils/TypedEventSink.test.ts` — unit tests covering: sequential emit/consume, buffering before iteration starts, `close()` completing the iterator, multiple-consumers error, and emit-after-close behavior.

### Step 2. Create shared Zod schemas

- **Create** directory `src/webviews/api/configuration/schemas/` with four files:
    - `querySchemas.ts` — `QueryMetadataSchema`, `SerializedQueryResultSchema`, `CosmosDBRecordIdentifierSchema`, `CosmosDBRecordSchema`. Derived from existing TypeScript types in `src/cosmosdb/types/queryResult.ts`.
    - `cosmosSchemas.ts` — `PartitionKeyDefinitionSchema`, `PartitionKeySchema` (matching `@azure/cosmos` types).
    - `documentSchemas.ts` — `OpenDocumentModeSchema` (`z.enum(['add','edit','view'])`), `BulkDeleteResultSchema`.
    - `aiSchemas.ts` — `ModelInfoSchema` (id, name, family, vendor).
- Add unit tests validating schema parsing for positive and negative inputs.

### Step 3. Extend router context types

- **Modify** `src/webviews/api/configuration/appRouter.ts` — add `QueryEditorRouterContext` and `DocumentRouterContext` types extending `BaseRouterContext` with fields for `eventSink`, `sessions`/`documentSession`, `connection`, `telemetryContext`, `panel` (per PRD §5.4).

### Step 4. Create empty router files with correct structure

- **Create** `src/webviews/api/configuration/queryEditorRouter.ts` — export `queryEditorRouter` with placeholder comments for each of the ~30 procedures.
- **Create** `src/webviews/api/configuration/queryEditorEventsRouter.ts` — export `queryEditorEventsRouter` with `QueryEditorEventSchema` discriminated union and an `events` subscription procedure that reads from `TypedEventSink<QueryEditorEvent>`.
- **Create** `src/webviews/api/configuration/documentRouter.ts` — export `documentRouter` with 5 document mutation stubs.
- **Create** `src/webviews/api/configuration/documentEventsRouter.ts` — export `documentEventsRouter` with `DocumentEventSchema` discriminated union and `events` subscription.
- **Modify** `appRouter.ts` to compose: `common`, `queryEditor` (merged router + events), `document` (merged router + events).

### ✅ Verification

- `npm run build` succeeds, all existing tests pass, new unit tests for `TypedEventSink` and Zod schemas pass.

---

## Phase 1: BaseTab Common Commands ✅ COMPLETED

### Step 5. Add 3 mutations to `commonRouter`

- **Modify** `appRouter.ts` — add `showInformationMessage`, `showErrorMessage`, and `executeReportIssueCommand` procedures to `commonRouter`, each using `trpcToTelemetry` middleware. Wire to `vscode.window.showInformationMessage`, `vscode.window.showErrorMessage`, and `vscode.commands.executeCommand('azureDatabases.reportIssue')`.

### Step 6. Update `BaseContextProvider` to use tRPC for these 3 commands

- **Modify** `src/webviews/utils/context/BaseContextProvider.tsx`:
    - Import `useTrpcClient` hook or accept a tRPC client parameter.
    - Replace `sendCommand('showInformationMessage', message)` → `trpcClient.common.showInformationMessage.mutate({ message })`.
    - Replace `sendCommand('showErrorMessage', message)` → `trpcClient.common.showErrorMessage.mutate({ message })`.
    - Replace `sendCommand('executeReportIssueCommand')` → `trpcClient.common.executeReportIssueCommand.mutate()`.
    - Keep `channel` and `sendCommand` active for all other commands (legacy coexistence).

### ✅ Verification

- Toast notifications, VS Code error dialogs, and "Report Issue" command work from both QueryEditor and Document webviews.

---

## Phase 2: DocumentTab Migration

### Step 7. Implement `documentRouter` procedures

- **Modify** `src/webviews/api/configuration/documentRouter.ts` — implement 5 mutations (`refreshDocument`, `saveDocument`, `saveDocumentAsFile`, `setMode`, `setDirty`) plus a `getInitialState` query. Move business logic from `DocumentTab.getCommand()` methods into these procedures.

### Step 8. Implement `documentEventsRouter` subscription

- **Modify** `src/webviews/api/configuration/documentEventsRouter.ts` — define the `DocumentEventSchema` discriminated union (7 variants: `initState`, `modeChanged`, `setDocument`, `documentSaved`, `documentError`, `queryError`, `operationAborted`) and the `events` subscription yielding from `TypedEventSink<DocumentEvent>`.

### Step 9. Refactor `DocumentSession` to use `TypedEventSink`

- **Modify** `src/cosmosdb/session/DocumentSession.ts`:
    - Change constructor to accept `TypedEventSink<DocumentEvent>` instead of `Channel`.
    - Replace every `this.channel.postMessage({ type: 'event', ... })` → `this.eventSink.emit({ type: '...', ... })`.

### Step 10. Refactor `DocumentTab` to wire tRPC

- **Modify** `src/panels/DocumentTab.ts`:
    - Create a `TypedEventSink<DocumentEvent>` in the constructor.
    - Pass the event sink to `DocumentSession` instead of `this.channel`.
    - Build a `DocumentRouterContext` and call `setupTrpc(context)`.
    - Remove `initController()` / `getCommand()` overrides — logic lives in router procedures.

### Step 11. Update `DocumentContextProvider` to use tRPC

- **Modify** `src/webviews/cosmosdb/Document/state/DocumentContextProvider.tsx`:
    - Replace all `sendCommand(...)` calls with `trpcClient.document.*.mutate(...)`.
    - Replace all `channel.on(...)` listeners with a single `trpcClient.document.events.subscribe(...)`.
    - Call `trpcClient.document.getInitialState.query()` on mount instead of emitting `ready`.

### ✅ Verification

- Document open, view, edit, save, refresh, save-as-file, mode switching, dirty state tracking all work end-to-end.

---

## Phase 3: QueryEditorTab Migration

### Step 12. Implement `queryEditorRouter` procedures

- **Modify** `src/webviews/api/configuration/queryEditorRouter.ts` — implement all ~30 mutations and queries. Move business logic from `QueryEditorTab.getCommand()`. Key procedures: `runQuery`, `stopQuery`, `nextPage`, `prevPage`, `firstPage`, `openFile`, `saveFile`, `duplicateTab`, `copyToClipboard`, `getConnections` (query), `setConnection`, `connectToDatabase`, `disconnectFromDatabase`, `openDocument`, `deleteDocument`, `deleteDocuments`, `generateQuery`, `cancelGenerateQuery`, `getSelectedModelName` (query), `getAvailableModels` (query), `setSelectedModel`, `openCopilotExplainQuery`, `saveCSV`, `copyCSVToClipboard`, etc.

### Step 13. Implement `queryEditorEventsRouter` subscription

- **Modify** `src/webviews/api/configuration/queryEditorEventsRouter.ts` — define the full `QueryEditorEventSchema` discriminated union (~17 variants) and the `events` subscription reading from `TypedEventSink<QueryEditorEvent>`.

### Step 14. Refactor `QuerySession` to use `TypedEventSink`

- **Modify** `src/cosmosdb/session/QuerySession.ts`:
    - Change constructor to accept `TypedEventSink<QueryEditorEvent>` instead of `Channel`.
    - Replace all `channel.postMessage` calls → typed `eventSink.emit(...)` for: `executionStarted`, `executionStopped`, `queryResults`, `queryError`.

### Step 15. Refactor `QueryEditorTab` to wire tRPC

- **Modify** `src/panels/QueryEditorTab.ts`:
    - Create `TypedEventSink<QueryEditorEvent>` in constructor.
    - Pass event sink to `QuerySession` instead of `this.channel`.
    - Build `QueryEditorRouterContext` and call `setupTrpc(context)`.
    - Move `updateConnection()`, `getConnections()`, `updateQueryHistory()` event emissions to use `eventSink.emit()`.
    - Remove `initController()` / `getCommand()` overrides.

### Step 16. Update `QueryEditorContextProvider` to use tRPC

- **Modify** `src/webviews/cosmosdb/QueryEditor/state/QueryEditorContextProvider.tsx`:
    - Replace all ~20 `sendCommand(...)` calls with `trpcClient.queryEditor.*.mutate(...)`.
    - Replace all `channel.on(...)` listeners with a single `trpcClient.queryEditor.events.subscribe(...)`.

### Step 17. Update `GenerateQueryInput.tsx`

- **Modify** `src/webviews/cosmosdb/QueryEditor/QueryPanel/GenerateQueryInput.tsx`:
    - Replace direct `channel.postMessage` calls → `trpcClient.queryEditor.generateQuery.mutate(...)`, `trpcClient.queryEditor.cancelGenerateQuery.mutate()`.
    - Use `useTrpcClient()` hook.

### ✅ Verification

- Full query editor flow: query execution, pagination, connection switching, AI query generation, CSV export, document ops, bulk delete, survey feedback.

---

## Phase 4: Cleanup

### Step 18. Remove legacy Communication directory

- **Delete** entire `src/panels/Communication/` directory (8 files: `Channel.ts`, `CommonChannel.ts`, `DeferredPromise.ts`, `VSCodeChannel.ts`, `WebviewChannel.ts`, `Transport.ts`, `VSCodeTransport.ts`, `WebviewTransport.ts`).

### Step 19. Remove `Channel` from `WebviewContext`

- **Modify** `src/webviews/WebviewContext.tsx`:
    - Remove `Channel`/`WebviewChannel` imports and `channel` from context value/type.

### Step 20. Remove `BaseTab` class and legacy helpers

- Remove `BaseTab` class from `src/panels/BaseTab.ts` or replace with a thin base using `WebviewController` patterns.
- Remove `sendCommand` helper from `BaseContextProvider`.
- Update all imports referencing Communication types.

### Step 21. Final validation

- Run `npm run l10n`, `npm run prettier-fix`, `npm run lint`.
- Confirm zero imports from `src/panels/Communication/`.

### ✅ Verification

- `npm run build` succeeds, all tests pass, no dead imports.

---

## ⚠️ Further Considerations

1. **Tab ↔ WebviewController integration** — `DocumentTab` and `QueryEditorTab` currently extend `BaseTab` which owns the panel HTML template. They need access to `setupTrpc()` from `WebviewController`. Recommended: **extract `setupTrpc` as a standalone utility function** for minimal refactoring since panel HTML templates differ between `BaseTab` and `WebviewBaseController`.

2. **`getErrorMessage` utility** — `QuerySession` and `DocumentSession` import `getErrorMessage` from `CommonChannel`. This utility should be **extracted to `src/utils/`** before Phase 4 deletes `CommonChannel`.

3. **Static methods like `QueryEditorTab.notifyAIFeaturesChanged`** — These broadcast events to all open tabs via `channel.postMessage`. After migration, they must iterate all open tabs' `TypedEventSink` instances and call `emit()`. Ensure the static tab registry exposes the event sink.

