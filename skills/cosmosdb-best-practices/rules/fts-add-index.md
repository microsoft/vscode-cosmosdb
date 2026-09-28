---
title: Add Full-Text Index in the Indexing Policy
impact: HIGH
impactDescription: without the index, FTS functions fall back to a full scan
tags:
  - fts
  - full-text-search
  - index
  - indexing-policy
  - bicep
---

## Add Full-Text Index in the Indexing Policy

**Impact: HIGH (without the index, FTS functions fall back to a full scan)**

The `fullTextIndexes` array in the `indexingPolicy` tells Cosmos DB to build an inverted index for the corresponding path. This is separate from the range index — a field can have both. Fields covered by a full-text index should **not** also appear in `excludedPaths`.

**Incorrect (field excluded from range index but no FTS index — slow scan):**

```bicep
excludedPaths: [
  { path: '/description/?' }   // excluded from range index...
]                               // ...but no fullTextIndexes entry → full scan
```

**Correct (Bicep):**

```bicep
indexingPolicy: {
  indexingMode: 'consistent'
  includedPaths: [
    { path: '/name/?' }
    { path: '/userid/?' }
  ]
  excludedPaths: [
    { path: '/*' }             // root wildcard
    // description NOT listed here — managed by FTS index below
  ]
  #disable-next-line BCP037
  fullTextIndexes: [
    { path: '/description' }   // inverted index — case-insensitive, tokenized
  ]
}
```

> A field under `fullTextIndexes` incurs **extra write RU** for index maintenance. Only index fields that are actually queried with `FullTextContains` or `FullTextScore`.

Reference: [Indexing policy for full-text search](https://learn.microsoft.com/azure/cosmos-db/gen-ai/full-text-search)
