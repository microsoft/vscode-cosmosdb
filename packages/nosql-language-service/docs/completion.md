# Completion Engine

## How It Works

The completion engine does **not** re-parse the query with the
full grammar. Instead, it uses a lightweight approach:

1. **Tokenize** the query up to the cursor position
2. **Detect context** — look at the last few tokens to determine
   where the cursor is (e.g., after `SELECT`, after `c.`, etc.)
3. **Generate items** — based on context, return keywords, schema
   fields, functions, or aliases
4. **Filter** by the typing prefix (what the user has already
   typed at cursor)
5. **Sort** by priority weights

## Context Detection

| Context | Detected When | Items Generated |
|---------|---------------|-----------------|
| `QueryStart` | Empty query | `SELECT` |
| `AfterSelect` | Previous token is `SELECT` | `*`, aliases, `TOP`, `DISTINCT`, `VALUE`, functions |
| `InSelectList` | After comma in SELECT clause | aliases, functions |
| `AfterFrom` | Previous token is `FROM` | (nothing — user types collection name) |
| `AfterFromClause` | Identifier after `FROM` | `WHERE`, `ORDER BY`, `JOIN`, `GROUP BY`, `OFFSET` |
| `AfterDot` | Text matches `alias.` | Schema fields from JSON Schema |
| `AfterWhere` | Previous token is `WHERE` | aliases, expression keywords, functions |
| `InExpression` | After operator or keyword | aliases, expression keywords, functions |
| `AfterOrder` | Previous token is `ORDER` | `BY` |
| `AfterGroup` | Previous token is `GROUP` | `BY` |
| `AfterOrderBy` | Previous token is `BY` | aliases |

## Priority Weights

Weights are encoded in `sortText` as zero-padded numbers.
Lower number = higher in the list. Monaco sorts by `sortText`
lexicographically.

### After `SELECT`:

| Priority | Item | Rationale |
|----------|------|-----------|
| 1 | `*` | Most common SELECT pattern |
| 2 | `c` (alias) | User usually types `c.field` |
| 10 | `TOP` | Common modifier (~20% of queries) |
| 15 | `DISTINCT` | Less common (~5%) |
| 20 | `VALUE` | Specialized usage |
| 50+ | `COUNT`, `SUM` | Aggregate functions |
| 80+ | `ST_DISTANCE` | Rare spatial functions |

### After `FROM c `:

| Priority | Item | Rationale |
|----------|------|-----------|
| 1 | `WHERE` | Vast majority of queries have WHERE |
| 5 | `ORDER BY` | Very common |
| 10 | `JOIN` | Common for nested arrays |
| 15 | `GROUP BY` | Less common |
| 20 | `OFFSET` | Pagination queries |

### In WHERE expressions:

| Priority | Item | Rationale |
|----------|------|-----------|
| 1 | `c` (alias) | Almost always start with alias |
| 5 | `AND` | Very common combinator |
| 8 | `OR` | Common combinator |
| 12 | `NOT` | Negation |
| 15 | `IN` | Set membership |
| 20 | `BETWEEN` | Range check |
| 22 | `LIKE` | Pattern matching |
| 25 | `EXISTS` | Subquery existence |
| 30+ | functions | `IS_DEFINED`, `CONTAINS`, etc. |

### Schema fields (after `c.`):

Fields are sorted by `x-occurrence` from the `JSONSchema` type
(provided by `@cosmosdb/schema-analyzer`). Higher occurrence =
appears earlier in the list.

Formula: `sortText = pad(1000 - occurrence) + fieldName`

### Functions:

Functions are grouped by category with sub-priorities:

| Sub-priority | Category | Examples |
|-------------|----------|----------|
| 0–4 | Aggregate | `COUNT`, `SUM`, `AVG`, `MIN`, `MAX` |
| 5–14 | Type checking | `IS_DEFINED`, `IS_NULL`, `IS_ARRAY` |
| 15–25 | String | `CONTAINS`, `STARTSWITH`, `LOWER` |
| 26–29 | Array | `ARRAY_LENGTH`, `ARRAY_CONTAINS` |
| 50+ | Others | Spatial, date/time, etc. |

## Alias Detection

The engine auto-detects collection aliases from the query:

- `FROM c` → alias `c`
- `FROM products AS p` → alias `p`
- `JOIN t IN c.tags` → alias `t`

These are used to:
1. Suggest aliases after `SELECT`, `WHERE`, etc.
2. Gate schema field suggestions — `c.` shows fields, `x.`
   doesn't (unless `x` is a known alias)

## Schema Navigation

For nested objects, the engine navigates the JSON Schema tree:

```
"SELECT c.address.geo." → path = ["address", "geo"]
                          ↓
schema.properties.address.properties.geo.properties
                          ↓
→ { lat: number, lng: number }
```

For arrays with object items:
```
"SELECT t." (where t IN c.tags) → path within items schema
schema.properties.tags.items.properties
→ { name: string, value: string }
```

## Monaco Integration

```typescript
import { getCompletions, type CompletionItemKind, type JSONSchema } from "@cosmosdb/nosql-language-service";

// Schema comes from @cosmosdb/schema-analyzer (extends JSONSchema7)
const currentCollectionSchema: JSONSchema = { /* ... */ };

monaco.languages.registerCompletionItemProvider("cosmosdb-sql", {
  provideCompletionItems(model, position) {
    const query = model.getValue();
    const offset = model.getOffsetAt(position);

    const items = getCompletions({
      query,
      offset,
      schema: currentCollectionSchema,
    });

    return {
      suggestions: items.map((item) => ({
        label: item.label,
        kind: mapKind(item.kind),
        detail: item.detail,
        insertText: item.insertText ?? item.label,
        sortText: item.sortText,
        range: undefined, // Monaco calculates this
      })),
    };
  },
});

function mapKind(kind: CompletionItemKind) {
  switch (kind) {
    case "keyword":  return monaco.languages.CompletionItemKind.Keyword;
    case "field":    return monaco.languages.CompletionItemKind.Field;
    case "function": return monaco.languages.CompletionItemKind.Function;
    case "snippet":  return monaco.languages.CompletionItemKind.Snippet;
    case "alias":    return monaco.languages.CompletionItemKind.Variable;
    default:         return monaco.languages.CompletionItemKind.Text;
  }
}
```

