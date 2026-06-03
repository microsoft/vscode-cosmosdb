---
name: telemetry-best-practices
description: Reviews and authors telemetry code in this extension. Use when adding, modifying, or reviewing any `callWithTelemetryAndErrorHandling` call, any `context.telemetry.properties`/`measurements` assignment, or any helper that reports stats to telemetry. Ensures no PII/EUII is emitted, that property vs. measurement usage is correct, and that event/property names are consistent.
---

# Telemetry Best Practices

This extension uses `@microsoft/vscode-azext-utils` (`callWithTelemetryAndErrorHandling`, `IActionContext.telemetry`) to emit telemetry events. Telemetry is **public** — assume every property and measurement value is shipped to a backend and visible to whoever has access to the dashboards. Treat every new property as a privacy decision.

These rules apply to **the entire codebase** (extension host, webviews, language services, helper packages), not to any single feature area.

## When to Use This Skill

Apply it whenever code:

- Calls `callWithTelemetryAndErrorHandling(...)`, `callWithTelemetryAndErrorHandlingSync(...)`, or registers a command (which wraps the same).
- Assigns to `context.telemetry.properties.*` or `context.telemetry.measurements.*`.
- Defines a helper (e.g. `report*Stats`, `track*`, `*Telemetry`) that mutates an `IActionContext`.
- Adds or renames a telemetry event string (the first argument to `callWithTelemetryAndErrorHandling`).

## Hard Rules — Never Emit PII / EUII

The following must **never** appear in `telemetry.properties` or `telemetry.measurements`, and never as part of an event name:

- File names, base names, file paths, directory names, workspace names.
- User IDs, resource names (other than the Azure account name — see below), database names, container/collection names, connection strings, hostnames, endpoints, ports.
- Query text, document contents, schema/DDL contents, error messages containing any of the above, free-form user input, prompts, AI responses.
- Email addresses, user names, machine names, IP addresses.
- Any string derived from the above (reversible hashes, prefixes, etc.).

**Not PII** (always allowed): the AI model identifiers `modelId`, `modelFamily`, `modelVendor` (vendor-published values from `vscode.LanguageModelChat`), bounded enums you control, durations, counts, and ratios.

### Allowed exceptions: OII identifiers under predefined property names

A small set of Azure identifiers are **OII** (Organization Identifiable Information), not PII, and may be emitted **as-is** — but **only** under the predefined property names listed below. The telemetry pipeline (and `@microsoft/vscode-azext-utils`) recognizes these names and handles them accordingly (subscription scoping, sanitization of the resource path, organization-tier classification, etc.).

| Key | Type | Notes |
| --- | --- | --- |
| `subscriptionId` | `string` | Azure subscription GUID. |
| `tenantId` | `string` | Azure / Entra tenant GUID. |
| `resourceId` | `vscode.TelemetryTrustedValue` | Full ARM resource id. Must be wrapped so VS Code's telemetry layer does not re-sanitize the path. |
| `accountName` | `string` | Azure resource (account) name, e.g. the Cosmos DB account name. |

```ts
context.telemetry.properties.subscriptionId = subscriptionId;
context.telemetry.properties.tenantId = tenantId;
context.telemetry.properties.accountName = account.name;
context.telemetry.properties.resourceId = new vscode.TelemetryTrustedValue(resourceId.rawId);
```

Rules:

- Use **exactly** these key names. Logging the same value under any other key (`subId`, `accountId`, `armId`, `cosmosAccount`, …) bypasses the special handling and counts as PII.
- `resourceId` must be wrapped in `new vscode.TelemetryTrustedValue(...)`.
- Do **not** decompose the resource id and emit its parts (`resourceGroup`, `databaseName`, `containerName`, …) under separate properties — only the four keys above are allowed; everything else is PII.
- Still push these values to `context.valuesToMask` so they are redacted from any error messages emitted alongside the event.

### Safe alternatives when you need to correlate or categorize

- A **non-persistent, in-memory session id** generated with `crypto.randomUUID()` per session/operation.
- A bounded enum (e.g. `'mongo' | 'postgres' | 'sqlserver'`), never a free-form string.
- A boolean flag (e.g. `hasCustomInstructions`) instead of the actual value.

### Red flags to look for in reviews

| Pattern | Action |
| --- | --- |
| `properties.fileName`, `properties.path`, `properties.basename`, `properties.fileBaseName` | Remove. |
| `properties.error = err.message` (raw) | Remove or replace with a category enum + sanitized code. |
| `properties.query`, `properties.sql`, `properties.ddl`, `properties.prompt`, `properties.response` | Remove. |
| `properties.<anything> = someUserInput` | Remove unless it is a validated bounded enum. |
| OII value (`subscriptionId`, `tenantId`, `resourceId`, `accountName`) emitted under a different key | Rename to the predefined key, or remove. |
| `resourceId` not wrapped in `vscode.TelemetryTrustedValue` | Wrap it. |
| Event name containing a user value (e.g. `` `cosmosDB.${dbName}.start` ``) | Replace with a static event name; move the value to a bounded enum property only if safe. |

## `context.valuesToMask` — Defense in Depth, Not a Substitute

`IActionContext.valuesToMask` is a list of strings that the telemetry pipeline replaces with `---` in any **error message** that would otherwise be reported (stack traces, `error.message`, the GitHub issue body produced by `reportIssue`). It does **not** redact values from `telemetry.properties` / `telemetry.measurements` you set yourself — those are sent verbatim.

Use it as a **safety net** for sensitive values that your code touches and might end up in a thrown error or log line you don't fully control:

```ts
// Extension host: push directly to the action context
context.valuesToMask.push(connectionString);
context.valuesToMask.push(masterKey, endpoint, databaseId, containerId);
context.valuesToMask.push(account.subscription.subscriptionId);
context.valuesToMask.push(userProvidedName); // database/container/resource names entered in a wizard

// Webview-bridged events: register on the per-webview TelemetryContext instead
telemetryContext.addMaskedValue(connectionString);
telemetryContext.addMaskedValue([endpoint, databaseId, containerId]);
```

### Rules

- **Always** push a value to `valuesToMask` as soon as you obtain it if it could end up in an error path. This includes:
    - Strict secrets that must never appear in telemetry: connection strings, keys, tokens, query text, document contents, partition keys, user-entered names (database, container, resource).
    - The OII identifiers (`subscriptionId`, `tenantId`, `resourceId`, `accountName`) — even though they are emitted as-is under their predefined keys, they should still be masked from error messages.
- This is **defense in depth**, not a license to put a strict secret into telemetry properties. Never do `properties.connectionString = cs` and rely on masking — only error-path strings are masked.
- Push **non-empty** strings only. Empty/whitespace values match everything and corrupt logs (the central `Telemetry.ts` filter already drops falsy values; do not bypass it).
- If a value has multiple equivalent forms a user might see (e.g. a partition key with and without a leading `/`), push **all** forms: `context.valuesToMask.push(partitionKey, partitionKey.slice(1));`
- Wizard `prompt`/`validateInput` steps that capture user input should push the captured value before the step returns. See `CosmosDBContainerNameStep`, `CosmosDBConnectionStringStep`, `CosmosDBPartitionKeyStep` for the pattern.
- Branch data providers and tree item factories should mask resource ids/names at construction time (see `CosmosDBBranchDataProvider`, `AccountInfo`).
- For values that should be masked across all events emitted by a single webview, register them once on that webview's `TelemetryContext` via `addMaskedValue(value)` (see `src/Telemetry.ts`); the mask list is then applied automatically to every `reportWebviewEvent` / `reportWebviewError` call from that webview.

## Properties vs. Measurements

`telemetry.properties` are **strings**, `telemetry.measurements` are **numbers**. Use them correctly:

- **String / enum / boolean → `properties`**. Stringify booleans (`String(value)`), keep enums short and bounded.
- **Counts, durations (ms), sizes (chars/bytes), ratios → `measurements`**. Never put a number in `properties` just because it is convenient.
- Round ratios/floats to a sensible precision; avoid emitting `NaN` or `Infinity` — guard with a check before assignment.
- Do not emit `null`/`undefined`. Skip the assignment if the value is missing.

## Naming Conventions

- Event names: `cosmosDB.<area>[.<subarea>].<action>` (two to four `camelCase` segments). Keep them **static** — no interpolated user data. Examples currently in use: `cosmosDB.nosql.queryEditor.executeQuery`, `cosmosDB.migration.ddlExtractor.extract`. Match an existing prefix if you are adding to an existing area instead of inventing a new top-level name.
- Property/measurement keys: `camelCase`, stable across versions. Renaming a key breaks dashboards and queries; prefer adding a new key over renaming.
- Reuse the same key name across events when the meaning is identical (e.g. `sessionId`, `durationMs`, `errorCategory`).

## Standard Patterns

### 1. Best-effort sub-events: suppress display + don't rethrow

```ts
await callWithTelemetryAndErrorHandling('cosmosDB.<area>.<action>', async (ctx) => {
    ctx.errorHandling.suppressDisplay = true;
    ctx.errorHandling.rethrow = false;
    // ... record measurements/properties (sync or async) ...
});
```

The callback may be sync or async; keep it `async` whenever the work inside is async. Use this for fire-and-forget instrumentation that must never affect the user-visible flow.

### 2. Rollups via a second `IActionContext`

When per-call events would be too chatty, accumulate counters on a longer-lived context's `measurements` and emit a single summary event at the end. Pass that context as an extra parameter (commonly named `phaseContext` / `rollupContext`) to the reporting helper.

### 3. Centralize cross-cutting enrichment

When the same set of properties (session id, mode, source type, etc.) appears at many call sites, put it in a single helper (`enrichWithMigrationContext`, `enrichWithQueryEditorContext`, …; `<Area>` is a placeholder for the actual feature name) and call that at the top of every event. Extend the helper instead of duplicating assignments.

### 4. Errors

- Set `properties.errorCategory` to a bounded enum. Reuse values already used in the codebase (`'ai'`, `'infrastructure'` in `migrationTelemetry.ts`) before introducing new ones.
- Do not put raw `error.message` into properties — it will likely contain user values.
- Prefer error **codes** over messages. If a message must be retained, ensure it cannot contain user values (paths, names, queries).
- `ctx.errorHandling.issueProperties` is the data appended to the body of the GitHub issue created when the user clicks **Report an Issue**. It is **not** a sanctioned PII channel — the same PII rules apply. Use it for diagnostic context (model id, error category, sanitized codes) that helps maintainers debug a reported issue.

## Review Checklist

When reviewing a diff that touches telemetry, confirm each item:

- [ ] No file names, paths, resource names, IDs, hostnames, queries, or free-form user input in any property/measurement. (Exceptions: OII identifiers `subscriptionId`, `tenantId`, `accountName`, and `resourceId` under those exact key names; `resourceId` wrapped in `vscode.TelemetryTrustedValue`.)
- [ ] Numbers go to `measurements`, strings/booleans/enums go to `properties`.
- [ ] Booleans are stringified (`String(value)`).
- [ ] Floats are rounded; no `NaN`/`Infinity` reach the assignment.
- [ ] Event name is static (no template interpolation of user values).
- [ ] Property/measurement keys use existing `camelCase` names where the meaning matches an existing key.
- [ ] Best-effort sub-events set `suppressDisplay = true` and `rethrow = false`.
- [ ] Errors are categorized via an enum, not raw messages.
- [ ] Any sensitive value the action touches (connection strings, keys, tokens, OII identifiers, resource/database/container names, endpoints, user-entered names, query text, partition keys) is pushed to `context.valuesToMask` as soon as it is obtained.
- [ ] JSDoc on any new `report*` / `track*` helper explicitly states "no file contents, paths, or names are emitted".
