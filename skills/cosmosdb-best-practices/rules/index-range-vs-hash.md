---
title: Choose Appropriate Index Types
impact: MEDIUM
impactDescription: optimizes query performance
tags: index, range, equality, types
---

## Choose Appropriate Index Types

Understand when to use different index types. Range indexes support equality, range, and ORDER BY; Hash indexes are deprecated.

**Understanding index types:**

```csharp
// Range Index (DEFAULT - recommended for most cases)
// Supports: =, >, <, >=, <=, !=, ORDER BY, JOINs
// Index entries: ["a"], ["a", "b"], ["a", "b", "c"]...
{
    "includedPaths": [
        {
            "path": "/price/?",
            "indexes": [
                {
                    "kind": "Range",  // Default, most flexible
                    "dataType": "Number",
                    "precision": -1   // -1 = maximum precision
                },
                {
                    "kind": "Range",
                    "dataType": "String",
                    "precision": -1
                }
            ]
        }
    ]
}
```

**Correct (modern indexing approach):**

```csharp
// Modern Cosmos DB automatically uses optimal index types
// You typically just specify paths, not index kinds
var indexingPolicy = new IndexingPolicy
{
    IndexingMode = IndexingMode.Consistent,
    Automatic = true,
    
    // Just specify paths - Cosmos DB handles index types
    IncludedPaths =
    {
        new IncludedPath { Path = "/category/?" },    // Equality queries
        new IncludedPath { Path = "/price/?" },       // Range queries
        new IncludedPath { Path = "/createdAt/?" },   // ORDER BY
        new IncludedPath { Path = "/tags/*" }         // Array elements
    },
    
    ExcludedPaths =
    {
        new ExcludedPath { Path = "/description/?" },  // Large text, not queried
        new ExcludedPath { Path = "/metadata/*" }      // Nested object, not queried
    }
};
```

```csharp
// For special query patterns, add composite or spatial indexes

var indexingPolicy = new IndexingPolicy
{
    // Standard range indexes (automatic)
    IncludedPaths =
    {
        new IncludedPath { Path = "/*" }  // Index everything by default
    },
    
    // Composite indexes for multi-property ORDER BY
    CompositeIndexes =
    {
        new Collection<CompositePath>
        {
            new CompositePath { Path = "/category", Order = CompositePathSortOrder.Ascending },
            new CompositePath { Path = "/price", Order = CompositePathSortOrder.Descending }
        }
    },
    
    // Spatial indexes for geo queries
    SpatialIndexes =
    {
        new SpatialPath
        {
            Path = "/location/?",
            SpatialTypes = { SpatialType.Point }
        }
    }
};
```

```json
// JSON policy showing all index types
{
    "indexingMode": "consistent",
    "automatic": true,
    "includedPaths": [
        { "path": "/*" }
    ],
    "excludedPaths": [
        { "path": "/largeContent/?" }
    ],
    "compositeIndexes": [
        [
            { "path": "/status", "order": "ascending" },
            { "path": "/createdAt", "order": "descending" }
        ]
    ],
    "spatialIndexes": [
        {
            "path": "/location/?",
            "types": ["Point"]
        }
    ]
}
```

Index type summary:
- **Range (default)**: Equality, range, ORDER BY - use for everything
- **Composite**: Multi-property ORDER BY, filter+sort
- **Spatial**: Geographic/geometric queries
- **Hash**: DEPRECATED - don't use

Reference: [Index types](https://learn.microsoft.com/azure/cosmos-db/index-overview)
