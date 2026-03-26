---
title: Use Composite Indexes for ORDER BY
impact: HIGH
impactDescription: enables sorted queries, reduces RU
tags: index, composite, orderby, sorting
---

## Use Composite Indexes for ORDER BY

Create composite indexes for queries with ORDER BY on multiple properties. Without them, queries may fail or require expensive client-side sorting.

**Incorrect (ORDER BY without composite index):**

```csharp
// Query with multi-property ORDER BY
var query = @"
    SELECT * FROM c 
    WHERE c.status = 'active' 
    ORDER BY c.createdAt DESC, c.priority ASC";

// Without composite index, this may:
// 1. Fail with: "Order-by item requires a corresponding composite index"
// 2. Or consume excessive RU for sorting
```

**Correct (composite index for ORDER BY):**

```csharp
// Create composite index matching the ORDER BY
var indexingPolicy = new IndexingPolicy
{
    IndexingMode = IndexingMode.Consistent,
    
    CompositeIndexes =
    {
        // Must match ORDER BY exactly (properties and sort order)
        new Collection<CompositePath>
        {
            new CompositePath { Path = "/createdAt", Order = CompositePathSortOrder.Descending },
            new CompositePath { Path = "/priority", Order = CompositePathSortOrder.Ascending }
        },
        
        // Add reverse order for flexibility
        new Collection<CompositePath>
        {
            new CompositePath { Path = "/createdAt", Order = CompositePathSortOrder.Ascending },
            new CompositePath { Path = "/priority", Order = CompositePathSortOrder.Descending }
        },
        
        // Common filter + sort pattern
        new Collection<CompositePath>
        {
            new CompositePath { Path = "/status", Order = CompositePathSortOrder.Ascending },
            new CompositePath { Path = "/createdAt", Order = CompositePathSortOrder.Descending }
        }
    }
};

var containerProperties = new ContainerProperties
{
    Id = "tasks",
    PartitionKeyPath = "/userId",
    IndexingPolicy = indexingPolicy
};
```

```json
// JSON indexing policy with composite indexes
{
    "indexingMode": "consistent",
    "automatic": true,
    "includedPaths": [
        { "path": "/*" }
    ],
    "compositeIndexes": [
        [
            { "path": "/status", "order": "ascending" },
            { "path": "/createdAt", "order": "descending" }
        ],
        [
            { "path": "/createdAt", "order": "descending" },
            { "path": "/priority", "order": "ascending" }
        ]
    ]
}
```

```csharp
// Common patterns that need composite indexes:

// Pattern 1: Filter + Sort
// WHERE status = 'x' ORDER BY date DESC
new Collection<CompositePath>
{
    new CompositePath { Path = "/status", Order = CompositePathSortOrder.Ascending },
    new CompositePath { Path = "/date", Order = CompositePathSortOrder.Descending }
}

// Pattern 2: Multi-column sort
// ORDER BY lastName ASC, firstName ASC
new Collection<CompositePath>
{
    new CompositePath { Path = "/lastName", Order = CompositePathSortOrder.Ascending },
    new CompositePath { Path = "/firstName", Order = CompositePathSortOrder.Ascending }
}

// Pattern 3: Range + Sort
// WHERE price >= 10 ORDER BY rating DESC
new Collection<CompositePath>
{
    new CompositePath { Path = "/price", Order = CompositePathSortOrder.Ascending },
    new CompositePath { Path = "/rating", Order = CompositePathSortOrder.Descending }
}
```

### Multi-Tenant Composite Index Patterns

In multi-tenant designs using type discriminators and hierarchical partition keys, composite indexes are **critical** for queries that filter by entity type and sort by common fields:

```json
// Multi-tenant SaaS: tasks by status, sorted by date
{
    "compositeIndexes": [
        [
            { "path": "/type", "order": "ascending" },
            { "path": "/status", "order": "ascending" },
            { "path": "/createdAt", "order": "descending" }
        ],
        [
            { "path": "/type", "order": "ascending" },
            { "path": "/assigneeId", "order": "ascending" },
            { "path": "/dueDate", "order": "ascending" }
        ],
        [
            { "path": "/type", "order": "ascending" },
            { "path": "/priority", "order": "descending" },
            { "path": "/createdAt", "order": "descending" }
        ]
    ]
}
```

```java
// Java: Composite indexes with IndexingPolicy
IndexingPolicy policy = new IndexingPolicy();

// Type + Status + Date (for: WHERE type='task' AND status='open' ORDER BY createdAt DESC)
List<CompositePath> statusSort = Arrays.asList(
    new CompositePath().setPath("/type").setOrder(CompositePathSortOrder.ASCENDING),
    new CompositePath().setPath("/status").setOrder(CompositePathSortOrder.ASCENDING),
    new CompositePath().setPath("/createdAt").setOrder(CompositePathSortOrder.DESCENDING)
);

// Type + Assignee + DueDate (for: WHERE type='task' AND assigneeId=@id ORDER BY dueDate)
List<CompositePath> assigneeSort = Arrays.asList(
    new CompositePath().setPath("/type").setOrder(CompositePathSortOrder.ASCENDING),
    new CompositePath().setPath("/assigneeId").setOrder(CompositePathSortOrder.ASCENDING),
    new CompositePath().setPath("/dueDate").setOrder(CompositePathSortOrder.ASCENDING)
);

policy.setCompositeIndexes(Arrays.asList(statusSort, assigneeSort));
```

**Why type discriminators need composite indexes:**
When a single container holds multiple entity types (tenant, user, project, task), queries always filter by `type`. Without a composite index on `(type, sortField)`, the query engine cannot efficiently sort within a single entity type. This is especially costly in containers with millions of mixed-type documents.

Rules:
- Composite index order must match ORDER BY exactly
- First path can be equality filter
- Include both ASC/DESC variants for flexibility
- Maximum 8 paths per composite index
- **Always** define composite indexes when using type discriminators in shared containers
- Include `/type` as the first path in multi-tenant composite indexes

Reference: [Composite indexes](https://learn.microsoft.com/azure/cosmos-db/index-policy#composite-indexes)
