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

Benefits of HPK:
- Each level combination creates separate logical partitions (no 20GB limit per tenant)
- Queries can target specific levels for efficiency
- Natural data organization (tenant → year → month)

Reference: [Hierarchical partition keys](https://learn.microsoft.com/azure/cosmos-db/hierarchical-partition-keys)
