---
title: Create Synthetic Partition Keys When Needed
impact: HIGH
impactDescription: optimizes for multiple access patterns
tags: partition, synthetic-key, composite, design
---

## Create Synthetic Partition Keys When Needed

When no single natural field serves as an ideal partition key, create a synthetic key by combining multiple fields.

**Incorrect (forced to choose suboptimal natural key):**

```csharp
// IoT scenario: need to query by device AND time range
public class Telemetry
{
    public string Id { get; set; }
    public string DeviceId { get; set; }  // Partition key?
    public DateTime Timestamp { get; set; }
    public double Value { get; set; }
}

// If partitioned by DeviceId alone:
// - Old data accumulates forever in same partition
// - Time-range queries still scan entire partition

// If partitioned by Timestamp alone:
// - Device queries are cross-partition
// - Hot partition on current time
```

**Correct (synthetic partition key):**

```csharp
public class Telemetry
{
    public string Id { get; set; }
    public string DeviceId { get; set; }
    public DateTime Timestamp { get; set; }
    public double Value { get; set; }
    
    // Synthetic key combining device + time bucket
    public string PartitionKey => $"{DeviceId}_{Timestamp:yyyy-MM}";
}

// Creates partitions like: "device123_2026-01", "device123_2026-02"
// Benefits:
// - Single device's data spreads across time-based partitions
// - Time-range queries can target specific partitions
// - No partition grows indefinitely

// Query device for specific month - single partition
var query = container.GetItemQueryIterator<Telemetry>(
    new QueryDefinition("SELECT * FROM c WHERE c.deviceId = @device")
        .WithParameter("@device", deviceId),
    requestOptions: new QueryRequestOptions
    {
        PartitionKey = new PartitionKey($"{deviceId}_2026-01")
    });
```

```csharp
// Multi-tenant with user-level isolation
public class UserDocument
{
    public string Id { get; set; }
    public string TenantId { get; set; }
    public string UserId { get; set; }
    
    // Synthetic key for tenant + user isolation
    public string PartitionKey => $"{TenantId}:{UserId}";
}

// Each user gets their own partition within tenant
// Query all user's docs - single partition
// Query tenant's docs - targeted cross-partition (just that tenant's users)
```

```csharp
// Order system with synthetic key
public class Order
{
    public string Id { get; set; }
    public string CustomerId { get; set; }
    public DateTime OrderDate { get; set; }
    
    // Combine customer + year for bounded partition growth
    public string PartitionKey => $"{CustomerId}_{OrderDate:yyyy}";
}
```

**Evaluate Hierarchical Partition Keys (HPK) when considering Synthetic Partition keys**:

   When suggesting synthetic partition keys as part of design, evaluate **Hierarchical Partition Keys (HPK)** as an alternative that provides efficient multi-level query boundaries without synthetic key complexity. 
   *(HPK natively supports efficient prefix-based cross-partition queries that synthetic keys cannot.)*

** Synthetic Key vs Hierarchical PK - Comparison table:**

   | Feature | Synthetic Key | Hierarchical PK |
   |---------|--------------|-----------------|
   | Query boundaries | Manual `STARTSWITH()` | Native prefix queries |
   | Key construction | Application-level string concat | Cosmos DB native |
   | Prefix queries | Inefficient (cross-partition) | Efficient (targeted) |
   
References:
- [Synthetic partition keys](https://learn.microsoft.com/azure/cosmos-db/nosql/synthetic-partition-keys)
- [Hierarchical partition keys (HPK)](https://learn.microsoft.com/azure/cosmos-db/nosql/hierarchical-partition-keys)
 
 *Additional HPK Considerations*: Evaluate HPK limitations and known issues for some SDKs, various connectors and account for Hierarchical Cardinality requirements of all levels.
