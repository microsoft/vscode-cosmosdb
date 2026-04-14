# Adding a New Webview Panel with tRPC

This guide explains how to add a new webview panel that communicates with the extension host via the shared tRPC infrastructure.

## Architecture Overview

```
┌───────────────┐   postMessage   ┌───────────────────┐
│   Webview     │ ◄─────────────► │  Extension Host   │
│  (React app)  │   vscodeLink    │   (tRPC server)   │
│               │                 │                   │
│  tRPC Client  │                 │  setupTrpc()      │
│  (vscodeLink) │                 │  ↓                │
│               │                 │  appRouter        │
│               │                 │   ├─ common       │
│               │                 │   ├─ queryEditor  │
│               │                 │   └─ document     │
└───────────────┘                 └───────────────────┘
```

## Steps

### 1. Define the Router Context

In `src/webviews/api/configuration/appRouter.ts`, add a new context type for your panel:

```typescript
export type MyPanelRouterContext = BaseRouterContext & {
  panel: vscode.WebviewPanel;
  eventSink: TypedEventSink<MyPanelEvent>;
  // ... any additional state your panel needs
};
```

### 2. Create Zod schemas

Add shared Zod schemas in `src/webviews/api/configuration/schemas/`:

```typescript
// myPanelSchemas.ts
import { z } from 'zod';

export const MyInputSchema = z.object({
  name: z.string(),
  value: z.number(),
});
```

Re-export from `schemas/index.ts`.

When the Zod-inferred type needs to match an existing TypeScript interface exactly, cast the schema:

```typescript
import { type MyResult } from '../../../../myModule';

export const MyResultSchema = z.object({
  id: z.string(),
  data: z.string().nullable(),
}) as unknown as z.ZodType<MyResult>;
```

> **Note:** Do not use `z.nativeEnum()` — it is deprecated in Zod v4. Use `z.enum()` for string enums or `z.union()` of `z.literal()` values for numeric enums.

### 3. Create a Typed Procedure

In `src/webviews/api/extension-server/trpc.ts`, add a typed procedure:

```typescript
export const myPanelProcedure = publicProcedure.use(({ ctx, next }) => {
  return next({ ctx: ctx as MyPanelRouterContext });
});
```

This narrows the `ctx` type so that every procedure handler has the correctly-typed context — no manual casts needed.

> **Always use typed procedures** instead of `publicProcedure` with manual `as` casts in handlers.

### 4. Create the Router

In `src/webviews/api/configuration/routers/myPanelRouter.ts`:

```typescript
import { myPanelProcedure, router, trpcToTelemetry } from '../../extension-server/trpc';
import { MyInputSchema, MyResultSchema } from '../schemas';

export const myPanelRouter = router({
  doSomething: myPanelProcedure
    .use(trpcToTelemetry)
    .input(MyInputSchema)
    .output(MyResultSchema) // optional: adds runtime validation of the response
    .mutation(async ({ input, ctx }) => {
      // ctx is typed as MyPanelRouterContext — no casts needed
      // Return the result directly — prefer request-response over push events
      return { id: input.name, data: 'done' };
    }),
});
```

> **Prefer returning data from mutations** instead of pushing events via `eventSink`. Only use events for truly async push scenarios (see below).

### 5. Create the Events Router (only if needed)

Events should only be used for **server-initiated push** that cannot be a mutation response:

- Background operations that complete after the mutation returns
- External notifications (e.g., settings changed, data pushed from outside)
- Mid-call interactions (e.g., confirmation dialogs during an async operation)

```typescript
import { z } from 'zod';

export const MyPanelEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('settingsChanged'), value: z.boolean() }),
]);

export type MyPanelEvent = z.infer<typeof MyPanelEventSchema>;

export const myPanelEventsRouter = router({
  events: myPanelProcedure.use(trpcToTelemetry).subscription(async function* ({ ctx }) {
    for await (const event of ctx.eventSink) {
      if (ctx.signal?.aborted) return;
      yield event;
    }
  }),
});
```

### 6. Register in `appRouter`

Use `mergeRouters` to combine routers into a flat namespace:

```typescript
import { mergeRouters, router } from '../extension-server/trpc';

export const appRouter = router({
  common: commonRouter,
  queryEditor: mergeRouters(queryEditorRouter, queryEditorEventsRouter),
  document: documentRouter,
  // If you have both a router and an events router:
  myPanel: mergeRouters(myPanelRouter, myPanelEventsRouter),
  // If you only have one router:
  myPanel: myPanelRouter,
});
```

### 7. Wire Up the Panel (Extension Side)

In your panel class:

```typescript
import { TypedEventSink } from '../utils/TypedEventSink';
import { setupTrpc } from '../webviews/api/extension-server/setupTrpc';

class MyPanel extends BaseTab {
    constructor(...) {
        super(...);

        const eventSink = new TypedEventSink<MyPanelEvent>();
        const context: MyPanelRouterContext = {
            webviewName: 'myPanel',
            panel: this.panel,
            eventSink,
        };

        const { disposable } = setupTrpc(this.panel, context);
        this.disposables.push(disposable);
    }
}
```

### 8. Create the Context Provider (Webview Side)

```typescript
export class MyPanelContextProvider extends BaseContextProvider {
  public async doSomething(name: string, value: number): Promise<void> {
    // Use the mutation return value directly
    const result = await this.trpcClient.myPanel.doSomething.mutate({ name, value });
    if (result) {
      this.dispatch({ type: 'setResult', result });
    }
  }

  protected initEventListeners() {
    // Only subscribe if you have push events
    this.trpcClient.myPanel.events.subscribe(undefined, {
      onData: (event) => {
        switch (event.type) {
          case 'settingsChanged':
            this.dispatch({ type: 'setSettings', value: event.value });
            break;
        }
      },
    });
  }
}
```

## Key Conventions

| Convention                 | Details                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Typed procedures**       | Always use typed procedures (e.g., `myPanelProcedure`) instead of `publicProcedure` with manual `as` casts.                              |
| **Telemetry middleware**   | Always use `trpcToTelemetry` middleware for telemetry/error reporting.                                                                   |
| **Request-response first** | Prefer returning data from mutations. Only use events for genuinely async push scenarios.                                                |
| **`mergeRouters`**         | Use `mergeRouters()` to combine routers into a flat namespace — do not use `._def.procedures`.                                           |
| **Zod schema casting**     | Use `as unknown as z.ZodType<T>` when `z.infer` must produce an exact external type.                                                     |
| **No `z.nativeEnum`**      | Deprecated in Zod v4. Use `z.enum()` or `z.union()` of `z.literal()` values.                                                             |
| **Output schemas**         | Use `.output()` on mutations when the return type is complex — provides runtime validation and helps avoid TS2589 deep inference errors. |
