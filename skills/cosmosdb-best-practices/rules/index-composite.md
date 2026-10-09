---
title: Use Composite Indexes for ORDER BY
impact: HIGH
impactDescription: enables sorted queries, reduces RU
tags: index, composite, orderby, sorting
---

## Use Composite Indexes for ORDER BY

Queries with `ORDER BY` on two or more properties require a matching composite index. Without it, Cosmos DB cannot execute that multi-property sort.

The default indexing policy indexes every property but does **not** create composite indexes. A query that combines a `WHERE` equality filter with a single-property `ORDER BY` on a different field can succeed using those range indexes. A composite index is an optional optimization for this pattern, not a prerequisite for executing the query.

To apply a composite index to a filter-plus-sort query, include the equality-filtered properties first in `ORDER BY`, followed by the sort property, and define a matching composite index. Those added properties are constant within the filtered results, so the rewrite preserves the requested ordering. Measure request charges to evaluate the benefit.

> ⚠️ **CreateContainerIfNotExists warning:** Defining a composite index in `CreateContainerIfNotExists` (or `createIfNotExists`) only applies the indexing policy when the container is created for the first time. If the container already exists, Cosmos DB returns the existing container, silently ignores the indexing policy argument, and keeps the existing indexing policy unchanged. To update composite indexes on an existing container, read the container, update its `IndexingPolicy`, and replace the container resource using the SDK's container replace operation. Always read the container back and verify that the expected composite indexes are present.

**Incorrect (multi-property ORDER BY without a matching composite index):**

```csharp
// Query with multi-property ORDER BY
var query = @"
    SELECT * FROM c 
    WHERE c.status = 'active' 
    ORDER BY c.createdAt DESC, c.priority ASC";

// This multi-property ORDER BY requires a matching composite index.
// Without one, the service rejects the query rather than sorting it less efficiently.
```

**Correct (composite index for ORDER BY):**

```csharp
// Create composite index matching the ORDER BY
var indexingPolicy = new IndexingPolicy
{
    IndexingMode = IndexingMode.Consistent,
    
    CompositeIndexes =
    {
        // Supports this path sequence with these directions or their full reverse
        new Collection<CompositePath>
        {
            new CompositePath { Path = "/createdAt", Order = CompositePathSortOrder.Descending },
            new CompositePath { Path = "/priority", Order = CompositePathSortOrder.Ascending }
        },
        
        // Optional filter + sort optimization:
        // WHERE status = 'active' ORDER BY status ASC, createdAt DESC
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
// Composite indexes for multi-property sorts, including optional filter + sort rewrites:

// Pattern 1: Optional rewrite of a single-property sort with an equality filter
// WHERE status = 'x' ORDER BY status ASC, date DESC
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

// Pattern 3: Range filter with a multi-property sort
// WHERE price >= 10 ORDER BY price ASC, rating DESC
new Collection<CompositePath>
{
    new CompositePath { Path = "/price", Order = CompositePathSortOrder.Ascending },
    new CompositePath { Path = "/rating", Order = CompositePathSortOrder.Descending }
}
```

### Multi-Tenant Composite Index Patterns

In multi-tenant designs using type discriminators and hierarchical partition keys, composite indexes can improve frequent type-filtered sorting queries. Match each index to the actual `ORDER BY` sequence, including equality-filtered fields added by an optimization rewrite:

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

// Type + Status + Date:
// WHERE type='task' AND status='open' ORDER BY type ASC, status ASC, createdAt DESC
List<CompositePath> statusSort = Arrays.asList(
    new CompositePath().setPath("/type").setOrder(CompositePathSortOrder.ASCENDING),
    new CompositePath().setPath("/status").setOrder(CompositePathSortOrder.ASCENDING),
    new CompositePath().setPath("/createdAt").setOrder(CompositePathSortOrder.DESCENDING)
);

// Type + Assignee + DueDate:
// WHERE type='task' AND assigneeId=@id ORDER BY type ASC, assigneeId ASC, dueDate ASC
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

**When type-filtered queries benefit from composite indexes:**
A type discriminator alone does not require a composite index. A query such as `WHERE c.type = 'task' ORDER BY c.createdAt DESC` can use range indexes. For frequent queries over mixed-type documents, consider the equivalent `ORDER BY c.type ASC, c.createdAt DESC` with a matching composite index to reduce RU consumption when beneficial.

### Node.js / TypeScript (@azure/cosmos v4)

The following are independent creation examples using different container IDs. Each assumes its container does not already exist; `create()` fails rather than silently retaining an existing policy. Use equivalent data when comparing request charges. For an existing application container, use the policy-update flow below instead of `createIfNotExists()`.

**Valid baseline (single-property sorting with default range indexes):**

```typescript
// The default policy creates range indexes, but no composite indexes.
const { container: baselineContainer } = await database.containers.create({
    id: 'orders-baseline',
  partitionKey: { paths: ['/userId'] },
});

// This single-property ORDER BY can use the default range indexes.
await baselineContainer.items.query({
  query: 'SELECT * FROM c WHERE c.userId = @u ORDER BY c.createdAt DESC',
  parameters: [{ name: '@u', value: userId }],
}, { partitionKey: userId }).fetchAll();
```

**Optional optimization (equivalent ORDER BY rewrite with a matching composite):**

```typescript
import { IndexingPolicy } from '@azure/cosmos';

// ✅ Declare composite indexes alongside container creation
const ordersIndexingPolicy: IndexingPolicy = {
  indexingMode: 'consistent',
  automatic: true,
  includedPaths: [{ path: '/*' }],
  excludedPaths: [{ path: '/"_etag"/?' }],
  compositeIndexes: [
    // WHERE c.userId = @u ORDER BY c.userId ASC, c.createdAt DESC
    [
      { path: '/userId', order: 'ascending' },
      { path: '/createdAt', order: 'descending' },
    ],
    // WHERE c.userId = @u AND c.status = @s ORDER BY c.userId ASC, c.status ASC, c.createdAt DESC
    [
      { path: '/userId', order: 'ascending' },
      { path: '/status', order: 'ascending' },
      { path: '/createdAt', order: 'descending' },
    ],
  ],
};

const { container: optimizedContainer } = await database.containers.create({
    id: 'orders-optimized',
  partitionKey: { paths: ['/userId'] },
  indexingPolicy: ordersIndexingPolicy,
});

await optimizedContainer.items.query({
    query: 'SELECT * FROM c WHERE c.userId = @u ORDER BY c.userId ASC, c.createdAt DESC',
    parameters: [{ name: '@u', value: userId }],
}, { partitionKey: userId }).fetchAll();
```

**Updating an existing container's indexing policy:**

Modify the full definition returned by `read()` so `replace()` preserves unrelated container settings, such as TTL.

```typescript
// Replace indexing policy on an existing container
const { resource: existing } = await database.container('orders').read();
if (!existing) {
    throw new Error('Container definition was not returned.');
}

existing.indexingPolicy = ordersIndexingPolicy;
await database.container('orders').replace(existing);
// Indexing is rebuilt in the background; monitor indexTransformationProgress
```

Rules:
- Composite paths must match the `ORDER BY` sequence; directions may match the index or be reversed on every path
- For equality-filtered sort optimizations, include the equality-filtered paths first in both `ORDER BY` and the composite index
- Do not add a duplicate inverse-direction index; add distinct direction combinations only when queries require them
- Maximum 8 paths per composite index
- Composite indexes consume additional write RU — declare only the composites you actually query against
- Evaluate composite indexes for frequent type-filtered sorting queries; a type filter alone does not require one
- Include `/type` first when it is equality-filtered and leads the optimized `ORDER BY`

Reference: [Composite indexes](https://learn.microsoft.com/azure/cosmos-db/index-policy#composite-indexes)
