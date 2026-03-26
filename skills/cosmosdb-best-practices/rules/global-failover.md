---
title: Configure Automatic Failover
impact: HIGH
impactDescription: ensures availability during outages
tags: global, failover, availability, disaster-recovery
---

## Configure Automatic Failover

Enable automatic failover for high availability. Without it, regional outages require manual intervention.

**Incorrect (no failover configuration):**

```csharp
// Multi-region account without automatic failover
// If primary region goes down:
// - Manual intervention required
// - Downtime until you notice and trigger failover
// - MTTR (Mean Time To Recovery) = hours potentially

// ARM template without failover
{
    "properties": {
        "enableAutomaticFailover": false,  // DEFAULT - dangerous!
        "locations": [
            { "locationName": "West US 2", "failoverPriority": 0 },
            { "locationName": "East US 2", "failoverPriority": 1 }
        ]
    }
}
```

**Correct (automatic failover enabled):**

```csharp
// ARM template with automatic failover
{
    "type": "Microsoft.DocumentDB/databaseAccounts",
    "apiVersion": "2021-10-15",
    "name": "my-cosmos-account",
    "properties": {
        "enableAutomaticFailover": true,  // Enable automatic failover!
        
        // Define failover priority order
        "locations": [
            { 
                "locationName": "West US 2", 
                "failoverPriority": 0,  // Primary
                "isZoneRedundant": true  // Zone redundancy for HA
            },
            { 
                "locationName": "East US 2", 
                "failoverPriority": 1   // First failover target
            },
            { 
                "locationName": "West Europe", 
                "failoverPriority": 2   // Second failover target
            }
        ]
    }
}
```

```csharp
// Configure SDK to handle failovers gracefully
var client = new CosmosClient(connectionString, new CosmosClientOptions
{
    ApplicationName = "MyApp",
    
    // SDK will automatically discover new endpoints after failover
    EnableTcpConnectionEndpointRediscovery = true,
    
    // Preferred regions in priority order
    ApplicationPreferredRegions = new List<string>
    {
        Regions.WestUS2,     // Primary
        Regions.EastUS2,     // Failover 1
        Regions.WestEurope   // Failover 2
    },
    
    // Connection will retry and discover new primary
    MaxRetryAttemptsOnRateLimitedRequests = 9,
    MaxRetryWaitTimeOnRateLimitedRequests = TimeSpan.FromSeconds(30)
});

// SDK handles failover transparently - your code doesn't change
await container.CreateItemAsync(order, new PartitionKey(order.CustomerId));
// If West US 2 is down, SDK automatically routes to East US 2
```

```csharp
// Monitor failover status
var accountProperties = await client.ReadAccountAsync();

Console.WriteLine($"Write regions: {string.Join(", ", 
    accountProperties.WritableRegions.Select(r => r.Name))}");
Console.WriteLine($"Read regions: {string.Join(", ", 
    accountProperties.ReadableRegions.Select(r => r.Name))}");

// Set up Azure Monitor alerts for:
// - Region failover events
// - Replication lag metrics
// - Availability metrics
```

```csharp
// Test failover (non-production)
// Azure CLI command to trigger manual failover
// az cosmosdb failover-priority-change \
//   --name mycosmosdb \
//   --resource-group myrg \
//   --failover-policies "East US 2"=0 "West US 2"=1

// Monitor your application behavior during failover test
// Expect: brief increase in latency, no data loss
```

Automatic failover behavior:
- Triggered after region unresponsive for ~1 minute
- Promotes next region in priority order
- SDK automatically reconnects to new primary
- No data loss with synchronous replication

Reference: [Automatic failover](https://learn.microsoft.com/azure/cosmos-db/high-availability)
