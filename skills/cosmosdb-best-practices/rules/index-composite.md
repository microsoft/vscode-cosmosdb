---
title: Use Composite Indexes for ORDER BY
impact: HIGH
impactDescription: enables sorted queries, reduces RU
tags: index, composite, orderby, sorting
---

## Use Composite Indexes for ORDER BY

Create composite indexes for queries with ORDER BY on multiple properties. Without them, queries may fail or require expensive client-side sorting.

The default indexing policy indexes every property but does **not** create composite indexes. Any query that combines a `WHERE` equality filter with `ORDER BY` on a different field needs a composite index declared explicitly, or the query will either fail in production or require expensive client-side sorting.

> **Emulator warning:** The Cosmos DB emulator silently permits `ORDER BY` queries without a matching composite index and returns identical RU charges. Production containers reject the same query with *"The order by query does not have a corresponding composite index that it can be served from."* Always declare composite indexes at container-create time — do not rely on emulator success as validation.

> ⚠️ **CreateContainerIfNotExists warning:** Defining a composite index in `CreateContainerIfNotExists` (or `createIfNotExists`) only applies the indexing policy when the container is created for the first time. If the container already exists, Cosmos DB returns the existing container, silently ignores the indexing policy argument, and keeps the existing indexing policy unchanged. To update composite indexes on an existing container, read the container, update its `IndexingPolicy`, and replace the container resource using the SDK's container replace operation. Always read the container back and verify that the expected composite indexes are present.

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

```rust
// Rust (azure_data_cosmos): Composite indexes via JSON deserialization
// CompositeIndex types cannot be constructed directly (marked non_exhaustive),
// so use JSON deserialization instead
use azure_data_cosmos::models::{ContainerProperties, IndexingPolicy, PartitionKeyDefinition};

let indexing_policy: IndexingPolicy = serde_json::from_value(serde_json::json!({
    "automatic": true,
    "indexingMode": "consistent",
    "includedPaths": [{"path": "/*"}],
    "excludedPaths": [{"path": "/_etag/?"}],
    "compositeIndexes": [
        [
            {"path": "/status", "order": "ascending"},
            {"path": "/createdAt", "order": "descending"}
        ],
        [
            {"path": "/customerId", "order": "ascending"},
            {"path": "/createdAt", "order": "descending"}
        ]
    ]
})).expect("valid indexing policy JSON");

let properties = ContainerProperties::new(
    "orders".to_string(),
    PartitionKeyDefinition::new(vec!["/customerId".to_string()]),
)
.with_indexing_policy(indexing_policy);

// Create container with composite indexes
db_client.create_container(properties, None).await?;
```

**Why type discriminators need composite indexes:**
When a single container holds multiple entity types (tenant, user, project, task), queries always filter by `type`. Without a composite index on `(type, sortField)`, the query engine cannot efficiently sort within a single entity type. This is especially costly in containers with millions of mixed-type documents.

### Node.js / TypeScript (@azure/cosmos v4)

**Incorrect (container created with default indexing policy — no composites):**

```typescript
// ❌ No indexingPolicy → default (indexes everything, no composite)
await database.containers.createIfNotExists({
  id: 'orders',
  partitionKey: { paths: ['/userId'] },
});

// This query works on the emulator but FAILS in production:
await container.items.query({
  query: 'SELECT * FROM c WHERE c.userId = @u ORDER BY c.createdAt DESC',
  parameters: [{ name: '@u', value: userId }],
}, { partitionKey: userId }).fetchAll();
```

**Correct (composite indexes declared at container creation):**

```typescript
import { IndexingPolicy } from '@azure/cosmos';

// ✅ Declare composite indexes alongside container creation
const ordersIndexingPolicy: IndexingPolicy = {
  indexingMode: 'consistent',
  automatic: true,
  includedPaths: [{ path: '/*' }],
  excludedPaths: [{ path: '/"_etag"/?' }],
  compositeIndexes: [
    // WHERE c.userId = @u ORDER BY c.createdAt DESC
    [
      { path: '/userId', order: 'ascending' },
      { path: '/createdAt', order: 'descending' },
    ],
    // WHERE c.userId = @u AND c.status = @s ORDER BY c.createdAt DESC
    [
      { path: '/userId', order: 'ascending' },
      { path: '/status', order: 'ascending' },
      { path: '/createdAt', order: 'descending' },
    ],
  ],
};

await database.containers.createIfNotExists({
  id: 'orders',
  partitionKey: { paths: ['/userId'] },
  indexingPolicy: ordersIndexingPolicy,
});
```

**Updating an existing container's indexing policy:**

```typescript
// Replace indexing policy on an existing container
const { resource: existing } = await database.container('orders').read();
await database.container('orders').replace({
  id: 'orders',
  partitionKey: existing!.partitionKey,
  indexingPolicy: ordersIndexingPolicy,
});
// Indexing is rebuilt in the background; monitor indexTransformationProgress
```

Rules:
- Composite index order must match ORDER BY exactly
- First path can be equality filter
- Include both ASC/DESC variants for flexibility
- Maximum 8 paths per composite index
- Composite indexes consume additional write RU — declare only the composites you actually query against
- **Always** define composite indexes when using type discriminators in shared containers
- Include `/type` as the first path in multi-tenant composite indexes

Reference: [Composite indexes](https://learn.microsoft.com/azure/cosmos-db/index-policy#composite-indexes)
