# PRD: tRPC-Based Communication Protocol for Webview-Extension Messaging

| Field       | Value                |
| ----------- | -------------------- |
| **Author**  | vscode-cosmosdb team |
| **Status**  | Draft                |
| **Created** | 2026-04-01           |
| **Updated** | 2026-04-01           |

---

## 1. Problem Statement

The VS Code extension uses two separate, incompatible communication systems for webview-extension messaging:

1. **Legacy Channel/Transport** (`src/panels/Communication/`) - Used by `BaseTab`, `DocumentTab`, `QueryEditorTab`, and the session classes (`QuerySession`, `DocumentSession`). This system dispatches commands via string-keyed `switch/case` blocks with unsafe `as Type` casts on positional `params` arrays. Server-to-client events use untyped `{ type: 'event', name: string, params: unknown[] }` payloads.

2. **tRPC-based system** (`src/webviews/api/`) - Used by the newer `WebviewController`-based webviews. This system provides Zod-validated procedures, typed routers, a custom `vscodeLink` transport, and telemetry middleware, but is only used by a subset of views.

### Key Deficiencies of the Legacy System

- **No type safety**: Commands are dispatched through `switch/case` on string names. Parameters are extracted with `payload.params[0] as string` casts (see `QueryEditorTab.ts` lines 205-296, `DocumentTab.ts` lines 151-169). A typo or parameter order change silently breaks at runtime.
- **Fragile event contracts**: Server-to-client events like `queryResults`, `executionStarted`, `setDocument`, and `databaseConnected` are string-keyed with positional `params: unknown[]` arrays. Refactoring any event signature is error-prone because the compiler cannot catch mismatches.
- **Inconsistent error handling**: The legacy system uses `DeferredPromise` with 15-second timeouts and `{ type: 'error', message: string }` payloads. The tRPC system uses `TRPCError` codes and structured `wrapInTrpcErrorMessage` serialization. These two error shapes are incompatible.
- **Duplicated telemetry**: `BaseTab` manually dispatches `reportWebviewEvent`/`reportWebviewError` commands, while tRPC already provides the `trpcToTelemetry` middleware.
- **Duplicated infrastructure**: Two transport layers (`VSCodeTransport`/`WebviewTransport` and the tRPC `vscodeLink`/`setupTrpc`) both solve the same problem - postMessage bridging - in different ways.

---

## 2. Goals

1. **Strictly typed routes**: Replace every `sendCommand(name, ...args)` / `switch/case` dispatch with Zod-validated tRPC mutations and queries.
2. **Strictly typed server-to-client events**: Replace `channel.postMessage({ type: 'event', name, params })` with tRPC subscriptions that yield typed discriminated-union event payloads.
3. **Robust error handling**: All errors flow through `getTRPCErrorFromUnknown` / `wrapInTrpcErrorMessage` with consistent `TRPCError` codes (`NOT_FOUND`, `BAD_REQUEST`, `INTERNAL_SERVER_ERROR`, etc.).
4. **Unified transport layer**: Both `BaseTab`-family and `WebviewController`-family panels use the same `vscodeLink` + `setupTrpc` postMessage infrastructure.
5. **Telemetry hooks**: All procedures use the existing `trpcToTelemetry` middleware from `src/webviews/api/extension-server/trpc.ts` for automatic tracing and performance metrics.
6. **Event emitting support**: The server (extension) can push notifications to the client (webview) at any time via tRPC subscriptions backed by async generators.
7. **Incremental migration**: Each tab/event group can be migrated independently; the legacy Channel can coexist temporarily during the transition.

---

## 3. Non-Goals

- Rewriting webview UI components or React state management patterns.
- Migrating to tRPC v12 (stay on v11 per current `@trpc/server: ~11.15.0`, `@trpc/client: ~11.15.0`).
- Changing the underlying `postMessage` transport mechanism (remains Electron IPC via `vscode.Webview.postMessage`).
- Modifying the `WebviewBaseController` HTML template or CSP policy.
- Changing business logic within `QuerySession`, `DocumentSession`, or tab controllers. Only the communication interface changes.

---

## 4. Architecture Overview

### 4.1 Current Architecture (Legacy)

```
Webview (React)
  BaseContextProvider / QueryEditorContextProvider / DocumentContextProvider
    sendCommand('runQuery', query, options)   // untyped string + positional args
      |
      v
  WebviewChannel --> WebviewTransport --> [postMessage] --> VSCodeTransport --> VSCodeChannel
                                                                                  |
                                                                                  v
                                                                              BaseTab.initController()
                                                                                channel.on('command', handler)
                                                                                  |
                                                                                  v
                                                                              QueryEditorTab.getCommand()
                                                                                switch (commandName) { ... }  // untyped dispatch
```

Server-to-client events flow in reverse:

```
QuerySession / DocumentSession / Tab
  channel.postMessage({ type: 'event', name: 'queryResults', params: [...] })   // untyped
    |
    v
  VSCodeChannel --> VSCodeTransport --> [postMessage] --> WebviewTransport --> WebviewChannel
                                                                                |
                                                                                v
                                                                            channel.on('queryResults', handler)
                                                                              dispatch({ type: 'updateQueryResult', ... })
```

### 4.2 Current Architecture (tRPC - WebviewController)

```
Webview (React)
  useTrpcClient() --> createTRPCClient<AppRouter>
    trpcClient.common.reportEvent.mutate({ eventName, properties })   // fully typed
      |
      v
  vscodeLink --> vscodeApi.postMessage({ id, op })
    |
    [postMessage]
    |
    v
  WebviewController.setupTrpc()
    onDidReceiveMessage --> switch(message.op.type)
      createCallerFactory(appRouter) --> caller[message.op.path](message.op.input)
        |
        v
      appRouter procedures (Zod-validated, telemetry-instrumented)
```

### 4.3 Target Architecture (Unified)

```
Webview (React)
  useTrpcClient() --> createTRPCClient<AppRouter>
      |
      +--> trpcClient.queryEditor.runQuery.mutate({ query, options })        // typed mutation
      +--> trpcClient.document.saveDocument.mutate({ documentText })         // typed mutation
      +--> trpcClient.queryEditor.events.subscribe(undefined, {              // typed subscription
      |      onData(event) { switch(event.type) { ... } }
      |    })
      +--> trpcClient.common.reportEvent.mutate({ eventName, properties })   // existing
      |
      v
  vscodeLink --> vscodeApi.postMessage({ id, op })
    |
    [postMessage]  (same-machine Electron IPC)
    |
    v
  Tab Controller (extends WebviewController)
    setupTrpc(context) --> handles queries, mutations, subscriptions
      |
      +--> queryEditorRouter procedures  (Zod-validated, telemetry-instrumented)
      +--> documentRouter procedures     (Zod-validated, telemetry-instrumented)
      +--> commonRouter procedures       (already exists)
      |
      +--> subscription procedures yield from TypedEventSink
             ^
             |
           QuerySession.emit({ type: 'queryResults', ... })
           DocumentSession.emit({ type: 'setDocument', ... })
           Tab.emit({ type: 'databaseConnected', ... })
```

### 4.4 Actor Roles

| Actor             | Role   | Runtime         | Transport Side               |
| ----------------- | ------ | --------------- | ---------------------------- |
| VS Code extension | Server | Node.js (main)  | `vscode.Webview.postMessage` |
| Webview (React)   | Client | Browser (frame) | `vscodeApi.postMessage`      |

The connection is **bidirectionally bound**:

- **Client-to-Server** (webview to extension): tRPC queries and mutations.
- **Server-to-Client** (extension to webview): tRPC subscriptions backed by async generators. The server yields events into the subscription stream; the client receives them via `onData` callbacks.

---

## 5. Detailed Design

### 5.1 Transport Layer

No new transport is needed. The existing `vscodeLink` (client-side) and `WebviewController.setupTrpc` (server-side) handle all postMessage plumbing. Both panel families will converge on this infrastructure.

The `vscodeLink` creates a per-operation observable that:

1. Generates a unique `operationId`.
2. Sends `{ id: operationId, op }` via `vscodeApi.postMessage`.
3. Listens for `{ id: operationId, result | error | complete }` responses.
4. For subscriptions, sends `{ id: operationId, op: { ...op, type: 'subscription.stop' } }` on unsubscribe.

On the server side, `WebviewController.setupTrpc` listens via `webview.onDidReceiveMessage` and dispatches to the appropriate tRPC procedure using `createCallerFactory(appRouter)`.

### 5.2 Router Structure

#### 5.2.1 Common Router (extend existing)

File: `src/webviews/api/configuration/appRouter.ts`

The existing `commonRouter` already contains `reportEvent`, `reportError`, `displayErrorMessage`, `surveyPing`, `surveyOpen`. Extend it with mutations currently handled by `BaseTab.getCommand()`:

| Procedure                   | Type     | Input Schema                        | Replaces                            |
| --------------------------- | -------- | ----------------------------------- | ----------------------------------- |
| `showInformationMessage`    | mutation | `z.object({ message: z.string() })` | `BaseTab.showInformationMessage`    |
| `showErrorMessage`          | mutation | `z.object({ message: z.string() })` | `BaseTab.showErrorMessage`          |
| `executeReportIssueCommand` | mutation | none                                | `BaseTab.executeReportIssueCommand` |

#### 5.2.2 Query Editor Router (new)

File: `src/webviews/api/configuration/queryEditorRouter.ts`

Contains all ~30 mutations from `QueryEditorTab.getCommand()`:

| Procedure                       | Type     | Input Schema (Zod)                                                                 |
| ------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `runQuery`                      | mutation | `{ query: string, options: QueryMetadataSchema }`                                  |
| `stopQuery`                     | mutation | `{ executionId: string }`                                                          |
| `nextPage`                      | mutation | `{ executionId: string }`                                                          |
| `prevPage`                      | mutation | `{ executionId: string }`                                                          |
| `firstPage`                     | mutation | `{ executionId: string }`                                                          |
| `openFile`                      | mutation | none                                                                               |
| `saveFile`                      | mutation | `{ text: string, filename: string, ext: string }`                                  |
| `duplicateTab`                  | mutation | `{ text: string }`                                                                 |
| `copyToClipboard`               | mutation | `{ text: string }`                                                                 |
| `getConnections`                | query    | none                                                                               |
| `setConnection`                 | mutation | `{ databaseId: string, containerId: string }`                                      |
| `connectToDatabase`             | mutation | none                                                                               |
| `disconnectFromDatabase`        | mutation | none                                                                               |
| `openDocument`                  | mutation | `{ mode: OpenDocumentModeSchema, documentId?: CosmosDBRecordIdentifierSchema }`    |
| `deleteDocument`                | mutation | `{ documentId: CosmosDBRecordIdentifierSchema }`                                   |
| `deleteDocuments`               | mutation | `{ documentIds: z.array(CosmosDBRecordIdentifierSchema) }`                         |
| `updateQueryHistory`            | mutation | `{ query?: string }`                                                               |
| `updateQueryText`               | mutation | `{ query: string }`                                                                |
| `generateQuery`                 | mutation | `{ prompt: string, currentQuery: string }`                                         |
| `cancelGenerateQuery`           | mutation | none                                                                               |
| `closeGenerateInput`            | mutation | none                                                                               |
| `getSelectedModelName`          | query    | none                                                                               |
| `getAvailableModels`            | query    | none                                                                               |
| `setSelectedModel`              | mutation | `{ modelId: string }`                                                              |
| `openCopilotExplainQuery`       | mutation | none                                                                               |
| `saveCSV`                       | mutation | `{ name: string, result: SerializedQueryResultSchema, partitionKey?, selection? }` |
| `saveMetricsCSV`                | mutation | `{ name: string, result: SerializedQueryResultSchema }`                            |
| `copyCSVToClipboard`            | mutation | `{ result: SerializedQueryResultSchema, partitionKey?, selection? }`               |
| `copyMetricsCSVToClipboard`     | mutation | `{ result: SerializedQueryResultSchema }`                                          |
| `provideFeedback`               | mutation | none                                                                               |
| `reportFeedback`                | mutation | `{ feedbackValue: z.enum(['up','down']), component: string }`                      |
| `confirmToolInvocationResponse` | mutation | `{ confirmed: boolean }`                                                           |

#### 5.2.3 Document Router (new)

File: `src/webviews/api/configuration/documentRouter.ts`

| Procedure            | Type     | Input Schema (Zod)                 |
| -------------------- | -------- | ---------------------------------- |
| `refreshDocument`    | mutation | none                               |
| `saveDocument`       | mutation | `{ documentText: string }`         |
| `saveDocumentAsFile` | mutation | `{ documentText: string }`         |
| `setMode`            | mutation | `{ mode: OpenDocumentModeSchema }` |
| `setDirty`           | mutation | `{ isDirty: boolean }`             |

#### 5.2.4 Query Editor Events Router (new subscription)

File: `src/webviews/api/configuration/queryEditorEventsRouter.ts`

A single subscription procedure `queryEditorEvents.subscribe` that yields a **discriminated union** of all server-to-client events. Each variant replaces a corresponding `channel.postMessage({ type: 'event', name, params })` call.

```typescript
// Discriminated union of all query editor events
const QueryEditorEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fileOpened'), query: z.string() }),
  z.object({
    type: z.literal('databaseConnected'),
    dbName: z.string(),
    containerName: z.string(),
    partitionKey: PartitionKeyDefinitionSchema.optional(),
  }),
  z.object({ type: z.literal('databaseDisconnected') }),
  z.object({
    type: z.literal('setConnectionList'),
    connectionList: z.record(z.string(), z.array(z.string())).optional(),
  }),
  z.object({ type: z.literal('executionStarted'), executionId: z.string(), startTime: z.number() }),
  z.object({ type: z.literal('executionStopped'), executionId: z.string(), endTime: z.number() }),
  z.object({
    type: z.literal('queryResults'),
    executionId: z.string(),
    result: SerializedQueryResultSchema,
    currentPage: z.number(),
  }),
  z.object({ type: z.literal('queryError'), executionId: z.string(), error: z.string() }),
  z.object({ type: z.literal('isSurveyCandidateChanged'), isSurveyCandidate: z.boolean() }),
  z.object({ type: z.literal('updateQueryHistory'), queryHistory: z.array(z.string()) }),
  z.object({ type: z.literal('updateThroughputBuckets'), throughputBuckets: z.array(z.boolean()) }),
  z.object({
    type: z.literal('queryGenerated'),
    generatedQuery: z.union([z.string(), z.literal(false)]),
    modelName: z.string().optional(),
    prompt: z.string().optional(),
  }),
  z.object({ type: z.literal('aiFeaturesEnabledChanged'), isEnabled: z.boolean() }),
  z.object({ type: z.literal('confirmToolInvocation'), message: z.string() }),
  z.object({ type: z.literal('selectedModelName'), modelName: z.string() }),
  z.object({
    type: z.literal('availableModels'),
    models: z.array(ModelInfoSchema),
    savedModelId: z.string().nullable(),
  }),
  z.object({ type: z.literal('documentDeleted'), documentId: CosmosDBRecordIdentifierSchema }),
  z.object({ type: z.literal('bulkDeleteComplete'), results: BulkDeleteResultSchema }),
]);
```

The subscription procedure is an async generator that reads from a `TypedEventSink<QueryEditorEvent>`:

```typescript
queryEditorEvents: publicProcedure
    .use(trpcToTelemetry)
    .subscription(async function* ({ ctx }) {
        const sink = (ctx as QueryEditorRouterContext).eventSink;
        for await (const event of sink) {
            if ((ctx as QueryEditorRouterContext).signal?.aborted) return;
            yield event;
        }
    }),
```

#### 5.2.5 Document Events Router (new subscription)

File: `src/webviews/api/configuration/documentEventsRouter.ts`

Same pattern as above. Discriminated union of document events:

```typescript
const DocumentEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('initState'),
    mode: OpenDocumentModeSchema,
    databaseId: z.string(),
    containerId: z.string(),
    documentId: z.string(),
    partitionKey: PartitionKeySchema.optional(),
  }),
  z.object({ type: z.literal('modeChanged'), mode: OpenDocumentModeSchema }),
  z.object({
    type: z.literal('setDocument'),
    sessionId: z.string(),
    documentContent: CosmosDBRecordSchema,
    partitionKey: PartitionKeyDefinitionSchema,
  }),
  z.object({ type: z.literal('documentSaved') }),
  z.object({ type: z.literal('documentError'), sessionId: z.string(), error: z.string() }),
  z.object({ type: z.literal('queryError'), sessionId: z.string(), error: z.string() }),
  z.object({ type: z.literal('operationAborted'), sessionId: z.string().optional(), message: z.string().optional() }),
]);
```

#### 5.2.6 Composed App Router

File: `src/webviews/api/configuration/appRouter.ts` (modified)

```typescript
export const appRouter = router({
  common: commonRouter,
  queryEditor: queryEditorRouter,
  document: documentRouter,
});

export type AppRouter = typeof appRouter;
```

### 5.3 TypedEventSink (new utility)

File: `src/utils/TypedEventSink.ts`

A typed async-iterable event emitter that bridges imperative `emit()` calls from sessions and tab controllers into the async generator consumed by tRPC subscriptions.

```typescript
export class TypedEventSink<T> implements AsyncIterable<T> {
    private queue: T[] = [];
    private resolve: ((value: IteratorResult<T>) => void) | null = null;
    private done = false;

    emit(event: T): void { ... }
    close(): void { ... }
    [Symbol.asyncIterator](): AsyncIterator<T> { ... }
}
```

This replaces all `channel.postMessage({ type: 'event', ... })` calls in sessions and tab controllers with typed `eventSink.emit({ type: 'queryResults', ... })` calls.

### 5.4 Router Context Enhancement

Extend `BaseRouterContext` to carry tab-specific state needed by procedures:

```typescript
export type BaseRouterContext = {
  dbExperience: API;
  webviewName: string;
  signal?: AbortSignal;
};

export type QueryEditorRouterContext = BaseRouterContext & {
  connection?: NoSqlQueryConnection;
  sessions: Map<string, QuerySession>;
  telemetryContext: TelemetryContext;
  panel: vscode.WebviewPanel;
  eventSink: TypedEventSink<QueryEditorEvent>;
};

export type DocumentRouterContext = BaseRouterContext & {
  connection: NoSqlQueryConnection;
  documentSession: DocumentSession;
  telemetryContext: TelemetryContext;
  panel: vscode.WebviewPanel;
  eventSink: TypedEventSink<DocumentEvent>;
};
```

Procedures access connection/session state through the context object rather than through closure over `this` in tab classes. Tab controllers remain the owners of sessions and state, populating the context before passing it to `setupTrpc()`.

### 5.5 Error Handling

All procedure errors are normalized through the existing `wrapInTrpcErrorMessage` helper in `WebviewController.ts`:

```typescript
wrapInTrpcErrorMessage(error: unknown, operationId: string) {
    const errorEntry = getTRPCErrorFromUnknown(error);
    return {
        id: operationId,
        error: {
            code: errorEntry.code,
            name: errorEntry.name,
            message: errorEntry.message,
            stack: errorEntry.stack,
            cause: errorEntry.cause,
        },
    };
}
```

Error mapping from legacy patterns:

| Legacy Error Source                    | tRPC Error Code         |
| -------------------------------------- | ----------------------- |
| `QuerySession` timeout                 | `TIMEOUT`               |
| `QuerySession` abort                   | `CLIENT_CLOSED_REQUEST` |
| `DocumentSession` not found            | `NOT_FOUND`             |
| Procedure not found                    | `NOT_FOUND`             |
| Invalid input (Zod validation failure) | `BAD_REQUEST`           |
| `Channel disposed` / connection lost   | `INTERNAL_SERVER_ERROR` |
| General Cosmos DB errors               | `INTERNAL_SERVER_ERROR` |

Session errors (e.g., `queryError`, `documentError`) that are part of the normal data flow are delivered as **typed event payloads** through the subscription, not as tRPC-level errors. This preserves the current behavior where query errors are displayed in the UI rather than breaking the connection.

### 5.6 Telemetry Integration

- All new router procedures use `.use(trpcToTelemetry)` middleware, which wraps each call in `callWithTelemetryAndErrorHandling` with the event name `cosmosDB.rpc.{type}.{path}`.
- The existing `TelemetryContext` class remains for tab-level telemetry (open/close events, masked values). It is passed through the router context.
- The `reportEvent` and `reportError` procedures in `commonRouter` remain the client-initiated telemetry path, replacing the legacy `reportWebviewEvent`/`reportWebviewError` command dispatch.
- Tab open/close telemetry stays in the controller constructor/dispose, outside of tRPC.

### 5.7 Client-Side Migration

#### BaseContextProvider

- Remove the `channel: Channel` constructor parameter.
- Replace the `sendCommand()` helper with direct tRPC client calls.
- Replace `init()` (which fires a `ready` event) with a tRPC `getInitialState` query.
- Replace `channel.on('showInformationMessage', ...)` with a subscription event handler.

#### QueryEditorContextProvider

- Replace all `sendCommand('runQuery', query, options)` calls with `trpcClient.queryEditor.runQuery.mutate({ query, options })`.
- Replace all `channel.on('queryResults', ...)` listeners with a single subscription:
  ```typescript
  trpcClient.queryEditor.events.subscribe(undefined, {
      onData(event) {
          switch (event.type) {
              case 'queryResults':
                  dispatch({ type: 'updateQueryResult', ... });
                  break;
              case 'executionStarted':
                  dispatch({ type: 'executionStarted', ... });
                  break;
              // ... etc
          }
      }
  });
  ```

#### DocumentContextProvider

- Same pattern as QueryEditorContextProvider but with `trpcClient.document.*` mutations and `trpcClient.document.events.subscribe`.

#### GenerateQueryInput (direct channel user)

- Replace direct `channel.postMessage({ type: 'event', name: 'command', params: [{ commandName: 'generateQuery', ... }] })` calls with `trpcClient.queryEditor.generateQuery.mutate({ prompt, currentQuery })`.

#### WebviewContext

- Remove `WebviewChannel` from the context value. The context only needs `vscodeApi` for `useTrpcClient()`.

### 5.8 Bootstrapping (Ready Handshake)

**Current**: The webview fires `channel.postMessage({ type: 'event', name: 'ready', params: [] })` on mount. The extension responds with initial state events.

**New**: Replace with a tRPC query `getInitialState` that returns the full initial state in a single typed response, plus immediately subscribing to the events subscription. This eliminates the race condition inherent in the fire-and-forget `ready` event.

For the Query Editor:

```typescript
// Client-side on mount:
const initialState = await trpcClient.queryEditor.getInitialState.query();
dispatch({ type: 'setInitialState', ...initialState });

// Then subscribe to ongoing events:
const subscription = trpcClient.queryEditor.events.subscribe(undefined, { onData(...) });
```

---

## 6. Shared Zod Schemas

File: `src/webviews/api/configuration/schemas/`

Shared Zod schemas for types that cross the communication boundary:

| Schema                           | Source Type                | File                 |
| -------------------------------- | -------------------------- | -------------------- |
| `QueryMetadataSchema`            | `QueryMetadata`            | `querySchemas.ts`    |
| `SerializedQueryResultSchema`    | `SerializedQueryResult`    | `querySchemas.ts`    |
| `CosmosDBRecordIdentifierSchema` | `CosmosDBRecordIdentifier` | `querySchemas.ts`    |
| `CosmosDBRecordSchema`           | `CosmosDBRecord`           | `querySchemas.ts`    |
| `PartitionKeyDefinitionSchema`   | `PartitionKeyDefinition`   | `cosmosSchemas.ts`   |
| `PartitionKeySchema`             | `PartitionKey`             | `cosmosSchemas.ts`   |
| `OpenDocumentModeSchema`         | `OpenDocumentMode`         | `documentSchemas.ts` |
| `ModelInfoSchema`                | (inline)                   | `aiSchemas.ts`       |
| `BulkDeleteResultSchema`         | (inline)                   | `documentSchemas.ts` |

These schemas serve as the **single source of truth** for the communication contract. Both the server-side procedures and the client-side TypeScript types are derived from them.

---

## 7. Migration Strategy

Migrate incrementally by domain. Each phase ships and is testable independently. The legacy Channel coexists with tRPC until Phase 4 removes it.

### Phase 0: Infrastructure

- Create `TypedEventSink<T>` utility.
- Create shared Zod schemas in `src/webviews/api/configuration/schemas/`.
- Extend `BaseRouterContext` with tab-specific context types.
- Create empty router files with the correct structure.
- Add unit tests for `TypedEventSink` and Zod schemas.

### Phase 1: BaseTab Common Commands

- Add `showInformationMessage`, `showErrorMessage`, `executeReportIssueCommand` to `commonRouter`.
- Update `BaseContextProvider` to use `trpcClient.common.*` for these three commands.
- Keep legacy Channel active for all other commands.
- Verify: Toast notifications, error dialogs, and report-issue still work.

### Phase 2: DocumentTab

- Create `documentRouter` with all Document mutations.
- Create `documentEventsRouter` with the document events subscription.
- Refactor `DocumentTab` to extend or compose `WebviewController`, wiring `setupTrpc()` with a `DocumentRouterContext`.
- Refactor `DocumentSession` to emit typed events into a `TypedEventSink<DocumentEvent>` instead of `channel.postMessage`.
- Update `DocumentContextProvider` to use tRPC mutations + subscription.
- Verify: Document open, edit, save, refresh, save-as-file all work.

### Phase 3: QueryEditorTab

- Create `queryEditorRouter` with all Query Editor mutations.
- Create `queryEditorEventsRouter` with the query editor events subscription.
- Refactor `QueryEditorTab` to extend or compose `WebviewController`.
- Refactor `QuerySession` to emit typed events into a `TypedEventSink<QueryEditorEvent>`.
- Update `QueryEditorContextProvider` to use tRPC mutations + subscription.
- Update `GenerateQueryInput.tsx` to use tRPC client directly.
- Verify: Query execution, pagination, connection switching, AI generation, CSV export, document operations from query results all work.

### Phase 4: Cleanup

- Remove `src/panels/Communication/` directory entirely.
- Remove `Channel` from `WebviewContext`.
- Remove `sendCommand` helper and all legacy event listener patterns.
- Remove the `BaseTab` class (replace with a new base that uses `WebviewController`).
- Update all imports.

---

## 8. File Structure

### New Files

```
src/
  utils/
    TypedEventSink.ts                              # Typed async iterable event emitter
    TypedEventSink.test.ts                         # Unit tests
  webviews/
    api/
      configuration/
        schemas/
          querySchemas.ts                          # Zod schemas for query types
          cosmosSchemas.ts                         # Zod schemas for Cosmos DB types
          documentSchemas.ts                       # Zod schemas for document types
          aiSchemas.ts                             # Zod schemas for AI model types
        queryEditorRouter.ts                       # Query editor mutations
        queryEditorEventsRouter.ts                 # Query editor subscription + event union
        documentRouter.ts                          # Document mutations
        documentEventsRouter.ts                    # Document subscription + event union
```

### Modified Files

```
src/
  webviews/
    api/
      configuration/
        appRouter.ts                               # Compose new routers
      extension-server/
        trpc.ts                                    # Potentially add context-aware middleware
  panels/
    BaseTab.ts                                     # Refactor to use WebviewController
    QueryEditorTab.ts                              # Move command logic to router procedures
    DocumentTab.ts                                 # Move command logic to router procedures
  cosmosdb/
    session/
      QuerySession.ts                              # Replace Channel with TypedEventSink
      DocumentSession.ts                           # Replace Channel with TypedEventSink
  webviews/
    utils/
      context/
        BaseContextProvider.tsx                     # Use trpcClient instead of sendCommand
    cosmosdb/
      QueryEditor/
        state/
          QueryEditorContextProvider.tsx            # Use tRPC mutations + subscription
        QueryPanel/
          GenerateQueryInput.tsx                    # Replace direct channel calls
      Document/
        state/
          DocumentContextProvider.tsx               # Use tRPC mutations + subscription
    WebviewContext.tsx                              # Remove WebviewChannel, simplify context
```

### Deleted Files (Phase 4)

```
src/panels/Communication/
  Channel/
    Channel.ts
    CommonChannel.ts
    DeferredPromise.ts
    VSCodeChannel.ts
    WebviewChannel.ts
  Transport/
    Transport.ts
    VSCodeTransport.ts
    WebviewTransport.ts
```

---

## 9. Acceptance Criteria

1. **Type safety**: All client-to-server calls and server-to-client events are Zod-validated. No `as Type` casts remain in the communication layer. A parameter change in a router procedure causes a compile-time error on both sides.
2. **Feature parity**: Every command and event in the current system has a tRPC equivalent. No user-visible behavior changes.
3. **Telemetry parity**: All procedures are instrumented via `trpcToTelemetry`. Existing telemetry event names (`cosmosDB.rpc.{type}.{path}`) and properties are preserved or improved.
4. **Error parity**: All error scenarios (timeout, abort, Cosmos DB errors, validation failures) produce equivalent user-facing messages.
5. **Legacy removal**: After Phase 4, no code imports from `src/panels/Communication/`.
6. **Tests**: Existing tests pass. New unit tests cover Zod schemas, router procedures, `TypedEventSink` lifecycle, and subscription event delivery.
7. **No runtime regressions**: Query execution, pagination, document CRUD, AI query generation, bulk delete, CSV export, connection switching, and survey feedback all function identically.

---

## 10. Design Decisions and Rationale

### 10.1 Single Subscription Per Tab vs. Multiple Subscriptions

**Decision**: One subscription per tab (e.g., `queryEditor.events.subscribe`).

**Rationale**: This mirrors the current 1:1 channel relationship where one `VSCodeChannel` instance serves one tab. It is simpler to manage lifecycle (subscribe on mount, unsubscribe on unmount). Multiple fine-grained subscriptions would add complexity for partial reconnection scenarios that are unlikely in a same-machine Electron IPC context.

### 10.2 Session State Ownership

**Decision**: Tab controllers remain session owners; router procedures are stateless dispatchers that access sessions through the router context.

**Rationale**: Sessions have complex lifecycle (creation, abort, disposal) tied to the tab lifecycle. Moving session management into the router layer would create an awkward separation of concerns. Instead, the tab controller populates the context with references to its sessions, and procedures use them as needed.

### 10.3 Event Delivery via Subscription vs. tRPC Error

**Decision**: Domain errors (e.g., query errors, document not found) are delivered as typed event payloads in the subscription stream, not as tRPC-level errors.

**Rationale**: These errors are part of the normal data flow: a query failing does not break the connection, and the UI needs to display the error in context. tRPC-level errors (`TRPCClientError`) should be reserved for infrastructure failures (procedure not found, serialization errors, transport failures).

### 10.4 Ready Handshake Replacement

**Decision**: Replace the fire-and-forget `ready` event with a `getInitialState` query.

**Rationale**: The current `ready` event creates a race condition: the extension starts pushing events before the webview has registered listeners. A query-based handshake is synchronous from the webview's perspective: the webview calls `getInitialState`, gets the full initial state, then subscribes to the event stream.

### 10.5 Stay on tRPC v11

**Decision**: Do not upgrade to tRPC v12.

**Rationale**: The project pins `@trpc/server: ~11.15.0` and `@trpc/client: ~11.15.0`. v12 has breaking changes and the custom `vscodeLink` + `subscription.stop` workaround would need updating. Migration to v12 is a separate effort.

---

## 11. Risks and Mitigations

| Risk                                                                        | Impact                             | Mitigation                                                                                                                    |
| --------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Large surface area (~30 commands + ~20 events)                              | High chance of regression          | Incremental migration by domain; each phase is independently testable                                                         |
| Subscription backpressure if session emits faster than postMessage delivers | Events could be dropped or delayed | `TypedEventSink` buffers events in an unbounded queue; postMessage is synchronous within Electron so backpressure is unlikely |
| Breaking change in Zod schema goes unnoticed                                | Runtime validation error           | Zod schemas serve as the compile-time contract; failing validation in development mode throws immediately                     |
| `GenerateQueryInput.tsx` uses channel directly (bypasses context provider)  | Requires separate migration        | Explicitly tracked as part of Phase 3                                                                                         |
| Concurrent subscriptions from same tab (e.g., reconnection)                 | Duplicate event delivery           | Tab controllers manage a single subscription lifecycle; unsubscribe before re-subscribing                                     |
