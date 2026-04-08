---
title: Exclude Unused Index Paths
impact: HIGH
impactDescription: reduces write RU by 20-80%
tags: index, exclusion, write-performance, optimization
---

## Exclude Unused Index Paths

Exclude paths from indexing that you never query. Every indexed path adds write cost with no read benefit.

**Incorrect (indexing everything):**

```csharp
// Default indexing policy indexes ALL paths
// Great for flexibility, expensive for writes
{
    "indexingMode": "consistent",
    "automatic": true,
    "includedPaths": [
        {
            "path": "/*"  // Indexes everything including unused fields
        }
    ],
    "excludedPaths": []
}

// Document with large unused fields gets indexed unnecessarily
{
    "id": "order-123",
    "customerId": "cust-1",          // Queried
    "status": "shipped",             // Queried
    "items": [...],                  // Not queried
    "internalNotes": "...",          // Not queried
    "auditLog": [...]                // Large array, never queried!
}
// Write cost includes indexing auditLog array - wasted RU
```

**Correct (exclude-all-first, then include back):**

```csharp
// Exclude everything, then include only what you query
var indexingPolicy = new IndexingPolicy
{
    IndexingMode = IndexingMode.Consistent,
    Automatic = true,
    
    // Start with exclude all — no field is indexed by default
    ExcludedPaths = { new ExcludedPath { Path = "/*" } },
    
    // Explicitly include only what you query
    IncludedPaths =
    {
        new IncludedPath { Path = "/customerId/?" },
        new IncludedPath { Path = "/status/?" },
        new IncludedPath { Path = "/orderDate/?" },
        new IncludedPath { Path = "/total/?" }
    }
};

var containerProperties = new ContainerProperties
{
    Id = "orders",
    PartitionKeyPath = "/customerId",
    IndexingPolicy = indexingPolicy
};
```

```json
// JSON equivalent indexing policy
{
    "indexingMode": "consistent",
    "automatic": true,
    "excludedPaths": [
        { "path": "/*" }
    ],
    "includedPaths": [
        { "path": "/customerId/?" },
        { "path": "/status/?" },
        { "path": "/orderDate/?" },
        { "path": "/total/?" }
    ]
}
```

⚠️ **Alternative (less optimal — indexes all paths by default):**

```csharp
// Selectively include and exclude paths
// WARNING: any new fields added to documents are auto-indexed
var indexingPolicy = new IndexingPolicy
{
    IndexingMode = IndexingMode.Consistent,
    Automatic = true,
    
    // Only include paths you actually query
    IncludedPaths =
    {
        new IncludedPath { Path = "/customerId/?" },
        new IncludedPath { Path = "/status/?" },
        new IncludedPath { Path = "/orderDate/?" },
        new IncludedPath { Path = "/total/?" }
    },
    
    // Exclude known unused paths (but new fields still auto-indexed)
    ExcludedPaths =
    {
        new ExcludedPath { Path = "/items/*" },         // Embedded array
        new ExcludedPath { Path = "/internalNotes/?" },
        new ExcludedPath { Path = "/auditLog/*" },      // Large array
        new ExcludedPath { Path = "/_etag/?" }          // System field
    }
};
```

Monitor and adjust:
- Review query patterns periodically
- Use Query Stats to see index utilization
- Balance write cost reduction vs query flexibility

Reference: [Indexing policies](https://learn.microsoft.com/azure/cosmos-db/index-policy)
