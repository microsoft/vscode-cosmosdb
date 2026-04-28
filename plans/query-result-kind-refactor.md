# Plan: Query Result Kind Refactor

**Branch:** `dev/dshilov/query-result-kind-refactor`
**Base:** `dev/dshilov/pr10-vite-vitest` (commit `f5ed6283`)
**Scope:** `src/utils/convertors.ts` + downstream UI consumers

---

## Motivation

The current `convertors.ts` converts raw CosmosDB query results into table/tree
structures by scanning document keys at runtime. This leads to:

- No validation that the actual data matches what the query promised
- `getTableDataset` re-does work that `getTableHeaders` already did
- `TableRecord` mixes metadata with data in one flat object, forcing awkward types
- Pre-serialising all values to strings loses the original data
- `documentToTreeRow` is called even for primitive results (`SELECT VALUE`)

---

## Phase 1 — `getQueryResultKind` (AST → expected result shape)

### New type

```typescript
/**
 * What shape of documents a query is statically expected to produce.
 *
 * - 'unknown'   — no query string, parse error, or cannot determine
 * - 'object'    — SELECT * / SELECT list / SELECT VALUE { ... }
 *                 → each document is a plain object with named keys
 * - 'primitive' — SELECT VALUE <scalar or array expression>
 *                 → each document is a scalar, null, or array (no named keys)
 */
export type QueryResultKind = 'unknown' | 'object' | 'primitive';
```

### AST mapping

| Query form             | spec kind         | expression                     | `QueryResultKind` |
| ---------------------- | ----------------- | ------------------------------ | ----------------- |
| `SELECT *`             | `SelectStarSpec`  | —                              | `'object'`        |
| `SELECT a, b`          | `SelectListSpec`  | —                              | `'object'`        |
| `SELECT VALUE { ... }` | `SelectValueSpec` | `ObjectCreateScalarExpression` | `'object'`        |
| `SELECT VALUE c.name`  | `SelectValueSpec` | `PropertyRefScalarExpression`  | `'primitive'`     |
| `SELECT VALUE 1+2`     | `SelectValueSpec` | `BinaryScalarExpression`       | `'primitive'`     |
| `SELECT VALUE [...]`   | `SelectValueSpec` | `ArrayCreateScalarExpression`  | `'primitive'`     |
| parse error / empty    | —                 | —                              | `'unknown'`       |

### Implementation sketch

```typescript
export const getQueryResultKind = (query: string | undefined | null): QueryResultKind => {
  if (!query) return 'unknown';
  const { ast, errors } = parse(query);
  if (errors.length > 0 || !ast) return 'unknown';

  const spec = ast.query.select.spec;
  if (spec.kind === 'SelectStarSpec' || spec.kind === 'SelectListSpec') return 'object';
  // SelectValueSpec — depends on the expression
  if (spec.expression.kind === 'ObjectCreateScalarExpression') return 'object';
  return 'primitive';
};
```

---

## Phase 2 — Reconciliation logic

Called at the top of `queryResultToTable` and `queryResultToTree`:

```
queryKind   dataKind    → action
─────────────────────────────────────────────────────────
any         'empty'     → return empty result immediately
'object'    'object'    → normal object path
'object'    'primitive' → throw Error (data/query mismatch)
'object'    'mixed'     → throw Error (should never happen for SELECT * / SELECT list)
'primitive' any         → scalar path: _value1 column, no partition key injection
'unknown'   'object'    → fallback: scan document keys (legacy behaviour)
'unknown'   'primitive' → _value1 column
'unknown'   'mixed'     → return empty result (cannot render safely)
```

### Error class

```typescript
export class QueryResultMismatchError extends Error {
  constructor(queryKind: QueryResultKind, dataKind: DocumentCollectionKind) {
    super(`Query expected "${queryKind}" results but got "${dataKind}" data`);
    this.name = 'QueryResultMismatchError';
  }
}
```

---

## Phase 3 — Simplify `TableRecord`

### Current (problematic)

```typescript
export type TableRecord = {
  __id: string;
  __documentId?: CosmosDBRecordIdentifier;
  [key: string]: string | CosmosDBRecordIdentifier | undefined | null;
  // ↑ metadata and data mixed; all values pre-serialised to string
};
```

### Proposed (Option D — split meta)

```typescript
/** Row metadata — never overlaps with document field names */
export type TableRowMeta = {
  __id: string;
  __documentId?: CosmosDBRecordIdentifier;
};

/**
 * A single table row.
 * `__id` and `__documentId` are internal; all other keys are raw document
 * values (not pre-serialised). The UI layer calls `toStringUniversal` /
 * `truncateString` at render time.
 */
export type TableRecord = TableRowMeta & {
  [key: string]: unknown;
};
```

**Benefits:**

- `getTableDataset` no longer copies and serialises every field
- Original values are preserved for sorting, filtering, copy-as-JSON
- TypeScript stops fighting the index signature
- Truncation becomes a pure UI concern

---

## Phase 4 — Refactor `getTableDataset`

Use `getDocumentCollectionKind` + `getQueryResultKind` reconciliation instead of
per-document branching.

### Object path (current documents are plain objects)

```typescript
// For each doc:
const row: TableRecord = {
  __id: uuid(),
  __documentId: getDocumentId(doc, partitionKey) ?? undefined
};
// Inject partition key virtual columns (keep string conversion here — these
// are synthetic columns not present in the actual document)
// Copy all document fields as raw values
Object.assign(row, doc);
result.push(row);
```

### Primitive path (`_value1`)

```typescript
const row: TableRecord = {
  __id: uuid(),
  _value1: doc // raw value; UI serialises
};
result.push(row);
```

**No partition key injection** for primitive path — the document IS the value.

---

## Phase 5 — Guard `documentToTreeRow`

`documentToTreeRow` only makes sense when each document is a structured object.

```typescript
export const queryResultToTree = async (
  queryResult: SerializedQueryResult | null,
  partitionKey: PartitionKeyDefinition | undefined
): Promise<TreeRow[]> => {
  if (!queryResult?.documents?.length) return [];

  const queryKind = getQueryResultKind(queryResult.query);
  const dataKind = getDocumentCollectionKind(queryResult.documents);

  // Tree view only supports object documents
  if (queryKind === 'primitive' || dataKind !== 'object') return [];
  if (queryKind === 'object' && dataKind !== 'object') {
    throw new QueryResultMismatchError(queryKind, dataKind);
  }
  // ...existing tree building loop
};
```

---

## Phase 6 — Value sanitisation (server-side)

String values that end up in the table/tree should be safe to render in a
webview without breaking layout or introducing XSS vectors.

### Rules

| Case                  | Action                                              |
| --------------------- | --------------------------------------------------- |
| Already a string      | Trim control characters (`\x00–\x1f` except `\t\n`) |
| Nested object / array | `JSON.stringify` → then apply string rules          |
| Very long value       | `truncateString(value, TruncateValues)`             |
| `null` / `undefined`  | Keep as-is (UI renders `null` / em-dash)            |

### Where

Add `sanitizeDisplayString(value: string): string` helper in `convertors.ts`.
Call it inside `getTableDataset` when writing string-typed values, **not** when
storing raw values (the raw value stays raw). The sanitised version goes into a
separate `display` layer or is applied only when `TruncateValues > 0`.

> **Decision needed:** do we store raw + display separately, or sanitise in-place?
> Recommendation: sanitise in-place in `getTableDataset` for now; add `__raw`
> field only if a "copy original" feature is required later.

---

## Phase 7 — `ColumnOptions` cleanup

`ShowPartitionKey` is only meaningful for `queryKind === 'object'`. Move the
`isSelectStar` check out of `queryResultToTable` and into `getTableHeaders`;
pass `queryKind` instead of re-parsing the query string twice.

---

## Commit sequence

```
feat: add getQueryResultKind + QueryResultKind type
feat: add QueryResultMismatchError
refactor: reconcile queryKind vs dataKind in queryResultToTable/queryResultToTree
refactor: simplify TableRecord — split meta, store raw values
refactor: rewrite getTableDataset using kind-based paths
feat: add sanitizeDisplayString, apply to string cell values
refactor: guard documentToTreeRow for object-only results
refactor: move isSelectStar logic into getTableHeaders via queryKind
chore: remove now-redundant ColumnOptions.TruncateValues from object path
```

---

## Resolved design decisions

### 1. `TableRecord[key]: unknown` — safe to change ✅

`ResultTabViewTable` already wraps each `TableRecord` as `__rawData` in a
`GridRow` and calls `toStringUniversal(value)` at render time (line 131).
`csvConverter.ts` already has `typeof value === 'string'` guard.

**Action:** remove pre-serialisation from `getTableDataset`. Change index
signature to `[key: string]: unknown`. Zero UI changes required.

### 2. Extend `getQueryColumns` for `SELECT VALUE { ... }` ✅

`SELECT VALUE { "x": c.id, "y": c.name }` produces objects with static keys.
The AST `ObjectCreateScalarExpression.properties[].name.value` is always a
string literal — names are statically knowable.

**Action:** add a `SelectValueSpec` branch to `getQueryColumns`:

```typescript
if (spec.kind === 'SelectValueSpec') {
  if (spec.expression.kind === 'ObjectCreateScalarExpression') {
    return spec.expression.properties.map((p) => p.name.value);
  }
  return null; // scalar / array / function → primitive path
}
```

This also allows `getQueryResultKind` to return `'object'` for `SELECT VALUE { ... }`.

### 3. Partition key injection — only for `SELECT *` ✅

For `SELECT c.id, c.name FROM c` the partition key field is absent from results.
Injecting a virtual PK column would show `undefined` for all rows — useless.

**Action:** `ShowPartitionKey: 'first'` is only set when `getQueryResultKind` returns
`'object'` AND the spec is `SelectStarSpec`. For `SelectListSpec` and
`SelectValueSpec` → always `'none'`.
