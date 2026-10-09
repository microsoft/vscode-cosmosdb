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

The `fullTextIndexes` array in the `indexingPolicy` tells Cosmos DB to build an inverted index for the corresponding path. This is separate from the range index — a field can have both. A field may be excluded from regular range indexing, explicitly or through a wildcard, while still being indexed for full-text search through `fullTextIndexes`. Retain appropriate range indexes for ordinary equality/range filters and `ORDER BY` queries as needed; a full-text index does not replace them.

**Incorrect (field excluded from range index but no FTS index — slow scan):**

```bicep
excludedPaths: [
  { path: '/description/?' }   // excluded from range index...
]                               // ...but no fullTextIndexes entry → full scan
```

**Correct (Bicep):**

Here `/name` and `/userid` retain range indexes. The root exclusion covers `/description` for regular range indexing, while its separate full-text index remains enabled.

```bicep
indexingPolicy: {
  indexingMode: 'consistent'
  includedPaths: [
    { path: '/name/?' }
    { path: '/userid/?' }
  ]
  excludedPaths: [
    { path: '/*' }             // excludes description from range indexing, not its full-text index
  ]
  #disable-next-line BCP037
  fullTextIndexes: [
    { path: '/description' }   // inverted index — case-insensitive, tokenized
  ]
}
```

> A field under `fullTextIndexes` incurs **extra write RU** for index maintenance. Only index fields that are actually queried with `FullTextContains` or `FullTextScore`.

Reference: [Indexing policy for full-text search](https://learn.microsoft.com/azure/cosmos-db/gen-ai/full-text-search)
