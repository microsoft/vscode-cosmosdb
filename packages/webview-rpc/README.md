# `@cosmosdb/webview-rpc`

Generic [tRPC](https://trpc.io) transport for VS Code webviews. The package is intentionally **application-agnostic** — it ships only the framework pieces (transport, middleware factories, adapter interfaces) and knows nothing about any specific extension's routers, contexts, or telemetry backend. Concrete logger / telemetry runners, tRPC instances, and routers all live in the consumer.

## What's in here

| Subpath                        | Side                               | Purpose                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@cosmosdb/webview-rpc`        | shared                             | `TypedEventSink<TEvent>` — single-consumer async event sink (re-exported from `./shared`).                                                                                                                                                                                                                                                      |
| `@cosmosdb/webview-rpc/server` | extension-host (Node + `vscode`)   | `setupTrpc`, `BaseRouterContext`, `WithRequired<T,K>`, middleware factories (`loggingMiddlewareBody`, `telemetryMiddlewareBody`), middleware types (`ProcedureInvocation`, `ProcedureType`, `MiddlewareResultLike`), `ProcedureLogger` / `TelemetryRunner` adapter interfaces, plus re-exports of `initTRPC` / `AnyRouter` from `@trpc/server`. |
| `@cosmosdb/webview-rpc/client` | webview (browser, no `vscode` API) | `vscodeLink`, `errorLink`, `createEventChannel` + `RpcEventChannel` / `RpcEventEmitter` types, wire-protocol types (`VsCodeLinkRequestMessage`, `VsCodeLinkResponseMessage`, `StopOperation`, `OperationContext`).                                                                                                                              |
| `@cosmosdb/webview-rpc/react`  | webview (browser, React)           | `WebviewContext` + `WithWebviewContext` provider and the `useTrpcClient<TRouter>()` hook. Returns `{ trpcClient, events }` — a per-webview singleton pair cached by `vscodeApi`, so every call inside the same webview hands back the **same** client and the **same** event channel. Re-exports `AnyRouter` for consumer-side type aliases.    |

## Wiring

A complete wire-up has three pieces: a **router on the server**, a **client in the webview**, and a shared **router type** the client imports for end-to-end type safety. tRPC itself is re-exported through this package, so the consumer never needs a direct `@trpc/*` import.

### 1. Server (extension host)

```ts
// src/panels/myAppRouter.ts  ──────────────────────────────────────────────────
import {
    type BaseRouterContext,
    initTRPC,
    loggingMiddlewareBody,
    setupTrpc,
    telemetryMiddlewareBody,
} from '@cosmosdb/webview-rpc/server';
import * as vscode from 'vscode';
import { z } from 'zod';
import { myLogger, myTelemetryRunner } from './observability'; // your adapters

// 1. Extend the framework's BaseRouterContext with whatever your procedures need.
//    `signal` (AbortSignal) is populated by setupTrpc per-call; `telemetry`
//    optionally by the telemetry middleware.
export interface MyRouterContext extends BaseRouterContext {
    panel: vscode.WebviewPanel;
    db: MyDatabaseConnection;
}

// 2. Build a tRPC instance bound to that context. One instance per webview
//    type keeps procedure type-inference precise — don't share across webviews.
const t = initTRPC.context<MyRouterContext>().create();

// 3. (Optional) Apply the shared middleware bodies via `t.middleware(...)`.
const procedure = t.procedure
    .use(t.middleware(loggingMiddlewareBody(myLogger)))
    .use(
        t.middleware(
            telemetryMiddlewareBody(myTelemetryRunner, {
                buildEventId: ({ type, path }) => `myApp.rpc.${type}.${path}`,
            }),
        ),
    );

// 4. Define routes. The full router type is what the client imports for
//    end-to-end type safety — *only the type*, never the value.
export const myAppRouter = t.router({
    greet: procedure
        .input(z.object({ name: z.string() }))
        .query(({ input }) => `hello, ${input.name}!`),

    saveDoc: procedure
        .input(z.object({ text: z.string() }))
        .mutation(async ({ ctx, input }) => {
            // ctx.signal is an AbortSignal — pass it to cancellable APIs.
            await ctx.db.write(input.text, { signal: ctx.signal });
        }),
});

export type MyAppRouter = typeof myAppRouter;

// 5. Attach the router to a webview panel. Returns a disposable that tears
//    down the message listener and aborts in-flight work on panel disposal.
export function attachMyRouter(panel: vscode.WebviewPanel, db: MyDatabaseConnection) {
    const ctx: MyRouterContext = { panel, db };
    const { disposable } = setupTrpc(panel, ctx, myAppRouter, t.createCallerFactory);
    return disposable;
}
```

### 2. Client — vanilla webview (no React)

If you're not using React, talk to `vscodeLink` directly. The link only needs a `send` callback (postMessage) and an `onReceive` subscriber that hands incoming responses to a handler.

```ts
// src/webview/main.ts ─────────────────────────────────────────────────────────
import {
    createEventChannel,
    errorLink,
    vscodeLink,
    type VsCodeLinkResponseMessage,
} from '@cosmosdb/webview-rpc/client';
import { createTRPCClient, loggerLink } from '@trpc/client';
import type { MyAppRouter } from '../panels/myAppRouter';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscodeApi = acquireVsCodeApi();

// One event channel per client. Subscribe / unsubscribe at will.
const events = createEventChannel();
events.onError((err, info) => console.error(`[tRPC] ${info.path}`, err));
events.onSuccess((info) => console.debug(`[tRPC] ${info.path} ok`));
events.onAborted((info) => console.debug(`[tRPC] ${info.path} canceled`));

const client = createTRPCClient<MyAppRouter>({
    links: [
        loggerLink(), // console diagnostics, optional
        errorLink<MyAppRouter>(events),
        vscodeLink<MyAppRouter>({
            send: (msg) => vscodeApi.postMessage(msg),
            onReceive: (handler) => {
                const listener = (event: MessageEvent) => {
                    const data = event.data as VsCodeLinkResponseMessage | undefined;
                    if (data?.id) handler(data);
                };
                window.addEventListener('message', listener);
                return () => window.removeEventListener('message', listener);
            },
        }),
    ],
});

const greeting = await client.greet.query({ name: 'world' });
```

### 3. Client — React webview

The `/react` subpath bundles the `acquireVsCodeApi` plumbing and the boilerplate above into two pieces: `WithWebviewContext` (provider) and `useTrpcClient` (hook).

`useTrpcClient` returns a **per-webview singleton** `{ trpcClient, events }` cached by `vscodeApi` — call the hook from as many components as you like; every caller in the same webview gets the same client and the same event channel. That means cross-cutting subscribers (toasts, ARIA announcements, telemetry) added anywhere in the tree see every event.

```tsx
// src/webview/index.tsx ───────────────────────────────────────────────────────
import { WithWebviewContext } from '@cosmosdb/webview-rpc/react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscodeApi = acquireVsCodeApi();

createRoot(document.getElementById('root')!).render(
    <WithWebviewContext vscodeApi={vscodeApi}>
        <App />
    </WithWebviewContext>,
);
```

```tsx
// src/webview/App.tsx ─────────────────────────────────────────────────────────
import { useTrpcClient } from '@cosmosdb/webview-rpc/react';
import { useEffect, useState } from 'react';
import type { MyAppRouter } from '../panels/myAppRouter';

export function App() {
    // Same `{ trpcClient, events }` for every call inside this webview.
    // `events` is identity-stable across renders → safe as a useEffect dep.
    const { trpcClient, events } = useTrpcClient<MyAppRouter>();

    // Cross-cutting handlers: subscribe anywhere, get every event.
    // Each `on*` returns an unsubscribe function — perfect for cleanup.
    useEffect(() => {
        const offError = events.onError((err, info) =>
            console.error(`[tRPC] ${info.path}: ${err.message}`),
        );
        const offAborted = events.onAborted((info) =>
            console.debug(`[tRPC] ${info.path} canceled`),
        );
        return () => {
            offError();
            offAborted();
        };
    }, [events]);

    const [greeting, setGreeting] = useState('');
    useEffect(() => {
        void trpcClient.greet.query({ name: 'world' }).then(setGreeting);
    }, [trpcClient]);

    return <h1>{greeting}</h1>;
}
```

> **Need to mutate responses (retry / fallback / payload rewrite)?** The event channel is intentionally **observer-only** — handlers can't change the value or convert errors into successes. Write a dedicated `TRPCLink` for that; it's the native tRPC extension point and we deliberately don't duplicate it.

### 4. Server → client streaming with `TypedEventSink`

For long-running work (background tasks, progress, log streams) the server pushes events through a `TypedEventSink` and exposes them as a tRPC subscription. The sink bridges imperative `emit()` calls into the async-iterable shape tRPC subscriptions consume.

```ts
// Server side
import { TypedEventSink } from '@cosmosdb/webview-rpc';

type AppEvent =
    | { type: 'progress'; percent: number }
    | { type: 'done'; result: string };

const events = new TypedEventSink<AppEvent>();

// Inside your router (re-using `t` and `procedure` from above):
export const myAppRouter = t.router({
    // ...other routes...
    onEvent: procedure.subscription(async function* ({ ctx }) {
        for await (const event of events) {
            if (ctx.signal?.aborted) return; // honour cancellation
            yield event;
        }
    }),
});

// Anywhere in your extension:
events.emit({ type: 'progress', percent: 42 });
events.emit('done', { result: 'ok' }); // two-arg form for autocompletion

// Don't forget to close the sink when the owning tab/session is disposed,
// otherwise the subscription generator never completes:
panel.onDidDispose(() => events.close());
```

```tsx
// React webview side
trpcClient.onEvent.subscribe(undefined, {
    onData: (event) => /* event is typed as AppEvent */ console.log(event),
    onError: (err) => console.error(err),
});
```

## Adapter pattern

The middleware bodies are **logger-agnostic** and **telemetry-runner-agnostic**. The consumer supplies concrete implementations of the two interfaces below and passes them to the factory functions:

```ts
import { type ProcedureLogger, type TelemetryRunner, loggingMiddlewareBody, telemetryMiddlewareBody } from '@cosmosdb/webview-rpc/server';

// Example: write a one-line summary to a vscode.LogOutputChannel.
const myLogger: ProcedureLogger = {
    onStart: ({ type, path }) => channel.debug(`[tRPC] ${type} ${path}`),
    onEnd: ({ type, path, durationMs, ok, aborted }) =>
        channel.debug(`[tRPC] ${type} ${path} ${aborted ? 'canceled' : ok ? 'ok' : 'error'} (${durationMs}ms)`),
};

// Example: open a scope per call, enrich ctx with it, then close it
// (success/failure decided from the MiddlewareResultLike).
const myRunner: TelemetryRunner<{ scope: MyScope }> = {
    async run(eventId, invocation, invoke) {
        const scope = openScope(eventId);
        try {
            const result = await invoke({ scope });
            scope.end(result.ok ? 'ok' : 'error', result.error);
            return result;
        } catch (err) {
            scope.end('error', err);
            throw err;
        }
    },
};

// Then wire them into your own tRPC instance:
const t = initTRPC.context<MyCtx>().create();
export const proc = t.procedure
    .use(t.middleware(loggingMiddlewareBody(myLogger)))
    .use(t.middleware(telemetryMiddlewareBody(myRunner, { buildEventId: ({ type, path }) => `myApp.${type}.${path}` })));
```

## Subpath separation

`/server` and `/client` are **strictly separated** so the webview bundler cannot accidentally pull `vscode` API imports into the browser bundle. Wire-protocol types live in `/` (shared) and are re-imported by both sides. The `/react` subpath builds on `/client` and is the only one that imports React.
