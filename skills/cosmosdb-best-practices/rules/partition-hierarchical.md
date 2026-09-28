---
title: Use Hierarchical Partition Keys for Flexibility
impact: HIGH
impactDescription: overcomes 20GB limit, enables targeted queries
tags: partition, hierarchical, multi-level, flexibility
---

## Use Hierarchical Partition Keys for Flexibility

Use hierarchical partition keys (HPK) to overcome the 20GB logical partition limit and enable targeted multi-partition queries.

**Incorrect (single-level hits 20GB limit):**

```csharp
// Problem: Large tenant exceeds 20GB logical partition limit
public class Document
{
    public string Id { get; set; }
    public string TenantId { get; set; }  // Single partition key
    // Large tenants hit 20GB ceiling!
}

// Must spread tenant data manually
// Queries across "big-tenant_shard1", "big-tenant_shard2" are complex
```

**Correct (hierarchical partition keys):**

```csharp
// Create container with hierarchical partition key
var containerProperties = new ContainerProperties
{
    Id = "documents",
    PartitionKeyPaths = new List<string> 
    { 
        "/tenantId",   // Level 1: Tenant
        "/year",       // Level 2: Year  
        "/month"       // Level 3: Month (optional)
    }
};

await database.CreateContainerAsync(containerProperties, throughput: 10000);

// Document with hierarchical key
public class Document
{
    public string Id { get; set; }
    public string TenantId { get; set; }
    public int Year { get; set; }
    public int Month { get; set; }
    public string Content { get; set; }
}

// Query targeting specific levels
// Level 1 only: scans all partitions for tenant
var tenantDocs = container.GetItemQueryIterator<Document>(
    new QueryDefinition("SELECT * FROM c WHERE c.tenantId = @tenant")
        .WithParameter("@tenant", "acme-corp"));

// Level 1+2: targets specific year partitions
var yearDocs = container.GetItemQueryIterator<Document>(
    new QueryDefinition("SELECT * FROM c WHERE c.tenantId = @tenant AND c.year = @year")
        .WithParameter("@tenant", "acme-corp")
        .WithParameter("@year", 2026),
    requestOptions: new QueryRequestOptions
    {
        PartitionKey = new PartitionKeyBuilder()
            .Add("acme-corp")
            .Add(2026)
            .Build()
    });

// Full key: single partition point read
var doc = await container.ReadItemAsync<Document>(
    docId,
    new PartitionKeyBuilder()
        .Add("acme-corp")
        .Add(2026)
        .Add(1)
        .Build());
```

**Python SDK example (hierarchical partition keys):**

```python
from azure.cosmos import PartitionKey

# Incorrect: single-level partition key for a large tenant workload
container = await database.create_container_if_not_exists(
    id="documents",
    partition_key=PartitionKey(path="/tenantId"),
)

# Correct: hierarchical partition key (broadest -> narrowest)
container = await database.create_container_if_not_exists(
    id="documents",
    partition_key=PartitionKey(
        path=["/tenantId", "/year", "/month"],
        kind="MultiHash",
    ),
)

# Point read with full partition key path values
item = await container.read_item(
    item="doc-123",
    partition_key=["acme-corp", 2026, 1],
)

# Prefix query scoped to Level 1 + Level 2
items = container.query_items(
    query="SELECT * FROM c WHERE c.tenantId = @tenant AND c.year = @year",
    parameters=[
        {"name": "@tenant", "value": "acme-corp"},
        {"name": "@year", "value": 2026},
    ],
    partition_key=["acme-corp", 2026],
)
```

**Order levels from broadest to narrowest scope.** HPK prefix queries work left-to-right — a query can efficiently target Level 1 alone, Levels 1+2, or Levels 1+2+3, but cannot efficiently target Level 3 alone without scanning all Level 1 and Level 2 combinations. Place the property that appears in the most queries at Level 1 (broadest), the next most common at Level 2, and the most granular at Level 3. This ensures the dominant access pattern always benefits from prefix-based routing.

**❌ Wrong — narrow before broad:**

```csharp
// Misordered: narrow scope before broad scope
var containerProperties = new ContainerProperties
{
    Id = "documents",
    PartitionKeyPaths = new List<string> 
    { 
        "/month",      // Level 1: Narrow (only 12 values)
        "/year",       // Level 2: Medium cardinality
        "/tenantId"    // Level 3: Broadest — but it's last!
    }
};

// Prefix queries work LEFT to RIGHT:
// ✅ Query by month only → targets 1 of 12 level-1 groups (very coarse, rarely useful)
// ✅ Query by month + year → targets specific month-year combo
// ❌ Query by tenantId ONLY → must scan ALL month/year combinations
//    because tenantId is at level 3, not queryable as a prefix
// The most common query ("get all docs for a tenant") becomes the MOST expensive
```

**✅ Right — broad to narrow:**

```csharp
// Correct: broad → narrow ordering
var containerProperties = new ContainerProperties
{
    Id = "documents",
    PartitionKeyPaths = new List<string> 
    { 
        "/tenantId",   // Level 1: Broadest — most common filter
        "/year",       // Level 2: Time-based narrowing
        "/month"       // Level 3: Finest granularity
    }
};

// Prefix queries work efficiently:
// ✅ Query by tenantId → targets all partitions for ONE tenant
// ✅ Query by tenantId + year → narrows to tenant's yearly data
// ✅ Query by tenantId + year + month → single logical partition
// The most common query ("get all docs for a tenant") is the CHEAPEST
```

Benefits of HPK:
- Each level combination creates separate logical partitions (no 20GB limit per tenant)
- Queries can target specific levels for efficiency
- Natural data organization (tenant → year → month)

Reference: [Hierarchical partition keys](https://learn.microsoft.com/en-us/azure/cosmos-db/hierarchical-partition-keys?tabs=python%2Cbicep#sdk)
