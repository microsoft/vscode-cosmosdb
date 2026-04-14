---
title: Configure Multi-Region Writes
impact: HIGH
impactDescription: enables local writes, high availability
tags: global, multi-region, writes, availability
---

## Configure Multi-Region Writes

Enable multi-region writes for globally distributed applications. Allows writes to any region with automatic conflict resolution.

**Incorrect (single write region):**

```csharp
// Default: Single write region
// All writes must travel to one region
// Users in Asia writing to US region: 200-300ms latency

// No multi-region write configuration
var client = new CosmosClient(connectionString);

// Write from Asia still goes to US (write region)
await container.CreateItemAsync(order);  // 200ms+ latency for Asian users
```

**Correct (multi-region writes enabled):**

```csharp
// Step 1: Enable multi-region writes on account (Azure Portal or ARM)
{
    "type": "Microsoft.DocumentDB/databaseAccounts",
    "properties": {
        "enableMultipleWriteLocations": true,  // Enable multi-region writes
        "locations": [
            { "locationName": "West US 2", "failoverPriority": 0 },
            { "locationName": "East Asia", "failoverPriority": 1 },
            { "locationName": "West Europe", "failoverPriority": 2 }
        ]
    }
}

// Step 2: Configure SDK to write locally
var client = new CosmosClient(connectionString, new CosmosClientOptions
{
    // SDK automatically routes to nearest region
    ApplicationPreferredRegions = new List<string>
    {
        Regions.EastAsia,    // First choice (if deployed in Asia)
        Regions.WestUS2,
        Regions.WestEurope
    }
});

// Write goes to nearest region (East Asia for Asian users)
await container.CreateItemAsync(order);  // <10ms latency locally!
```

```csharp
// Step 3: Handle conflicts (Last Writer Wins is default)
// For custom conflict resolution, configure container

// Last Writer Wins (LWW) - Default
// Uses _ts (timestamp) to determine winner
var containerWithLWW = new ContainerProperties
{
    Id = "orders",
    PartitionKeyPath = "/customerId",
    ConflictResolutionPolicy = new ConflictResolutionPolicy
    {
        Mode = ConflictResolutionMode.LastWriterWins,
        ResolutionPath = "/_ts"  // Higher timestamp wins
    }
};

// Custom resolution path (e.g., version number)
var containerWithCustomLWW = new ContainerProperties
{
    Id = "products",
    PartitionKeyPath = "/categoryId",
    ConflictResolutionPolicy = new ConflictResolutionPolicy
    {
        Mode = ConflictResolutionMode.LastWriterWins,
        ResolutionPath = "/version"  // Higher version wins
    }
};
```

```csharp
// Verify multi-region write is working
var accountProperties = await client.ReadAccountAsync();
Console.WriteLine($"Multi-region writes: {accountProperties.EnableMultipleWriteLocations}");
Console.WriteLine($"Write regions: {string.Join(", ", 
    accountProperties.WritableRegions.Select(r => r.Name))}");
```

Benefits:
- Local write latency (< 10ms vs 200ms+)
- Higher write availability (any region can accept writes)
- Better disaster recovery

Considerations:
- Higher cost (replication in both directions)
- Requires conflict resolution strategy
- Some operations have restrictions (stored procedures)

Reference: [Multi-region writes](https://learn.microsoft.com/azure/cosmos-db/multi-region-writes)
