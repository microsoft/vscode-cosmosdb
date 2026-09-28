---
title: Use Correct Indexing Path Syntax
impact: HIGH
impactDescription: prevents container creation failures from invalid paths
tags: index, path, syntax, array, wildcard
---

## Use Correct Indexing Path Syntax

Cosmos DB indexing paths use specific notation for scalars, arrays, and wildcards. Using the wrong notation causes container creation to fail with a BadRequest error.

**Three valid path notations:**

| Notation | Meaning | Example |
|----------|---------|---------|
| `/?` | Scalar value (string or number) | `/price/?` |
| `/[]` | Array element traversal | `/items/[]/name/?` |
| `/*` | **Terminal** wildcard — everything below this node | `/metadata/*` |

**Incorrect (using `*` for array traversal):**

```json
// ❌ WRONG — * cannot be used mid-path for array traversal
// This causes: "The indexing path could not be accepted, failed near position ..."
{
    "excludedPaths": [
        { "path": "/lineItems/*/productSnapshot/?" },
        { "path": "/orders/*/items/?" }
    ]
}
```

**Correct (using `[]` for array traversal):**

```json
// ✅ CORRECT — use [] to traverse array elements
{
    "excludedPaths": [
        { "path": "/lineItems/[]/productSnapshot/?" },
        { "path": "/orders/[]/items/?" }
    ]
}
```

**Correct (terminal `*` wildcard for subtree):**

```json
// ✅ CORRECT — * at the END of a path matches everything below
{
    "includedPaths": [
        { "path": "/*" }
    ],
    "excludedPaths": [
        { "path": "/metadata/*" },
        { "path": "/auditLog/*" },
        { "path": "/\"_etag\"/?" }
    ]
}
```

**Common patterns:**

```json
{
    "includedPaths": [
        { "path": "/*" }
    ],
    "excludedPaths": [
        { "path": "/\"_etag\"/?" },
        { "path": "/largeBlob/*" },
        { "path": "/items/[]/internalNotes/?" },
        { "path": "/events/[]/payload/*" }
    ]
}
```

**Key rules:**

- `/?` terminates a path to a scalar value — use for leaf properties
- `/[]` traverses into array elements — use when the parent is an array and you need to reach nested properties
- `/*` is a terminal wildcard — it means "all descendants" and must be the LAST segment in the path
- **NEVER** use `*` in the middle of a path (e.g., `/items/*/name/?` is INVALID)
- For composite indexes, paths do NOT use `/?` or `/*` — they have an implicit `/?` at the end. Use `/[]` for array traversal in composite paths (e.g., `/children/[]/age`)

Reference: [Indexing policy path syntax](https://learn.microsoft.com/azure/cosmos-db/index-policy#include-exclude-paths)
