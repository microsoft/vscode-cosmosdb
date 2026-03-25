---
title: Configure Preferred Regions for Availability
impact: HIGH
impactDescription: enables automatic failover, reduces latency
tags: sdk, regions, availability, failover
---

## Configure Preferred Regions for Availability

Configure preferred regions in priority order for multi-region deployments. The SDK automatically routes to available regions during outages.

**Incorrect (no region configuration):**

```csharp
// No region preference - SDK uses account's default write region
var client = new CosmosClient(connectionString);

// Problems:
// - May route to distant region (high latency)
// - No automatic failover if region goes down
// - Unpredictable behavior during partial outages
```

**Correct (explicit region configuration):**

```csharp
// Configure preferred regions in order of preference
var client = new CosmosClient(connectionString, new CosmosClientOptions
{
    ApplicationName = "MyApp",
    
    // SDK tries regions in order until one succeeds
    ApplicationPreferredRegions = new List<string>
    {
        Regions.WestUS2,      // Primary (closest to users)
        Regions.EastUS2,      // Secondary (nearby)
        Regions.WestEurope    // Tertiary (disaster recovery)
    }
});

// SDK automatically:
// 1. Connects to first available region in list
// 2. Fails over to next region if current becomes unavailable
// 3. Fails back when preferred region recovers
```

```csharp
// Dynamic region based on deployment
public static CosmosClient CreateClient(string connectionString, string deploymentRegion)
{
    var preferredRegions = deploymentRegion switch
    {
        "westus" => new List<string> { Regions.WestUS2, Regions.EastUS2, Regions.WestEurope },
        "eastus" => new List<string> { Regions.EastUS2, Regions.WestUS2, Regions.WestEurope },
        "europe" => new List<string> { Regions.WestEurope, Regions.NorthEurope, Regions.EastUS2 },
        _ => new List<string> { Regions.WestUS2 }
    };
    
    return new CosmosClient(connectionString, new CosmosClientOptions
    {
        ApplicationPreferredRegions = preferredRegions
    });
}
```

```csharp
// For multi-region writes, enable endpoint discovery
var client = new CosmosClient(connectionString, new CosmosClientOptions
{
    ApplicationPreferredRegions = new List<string>
    {
        Regions.WestUS2,
        Regions.EastUS2
    },
    
    // Enable endpoint discovery for multi-region accounts
    EnableTcpConnectionEndpointRediscovery = true,
    
    // For multi-region writes, writes can go to any region
    // SDK handles routing automatically
});
```

```csharp
// Verify region routing in diagnostics
var response = await container.ReadItemAsync<Order>(orderId, new PartitionKey(customerId));
var diagnostics = response.Diagnostics.ToString();
_logger.LogDebug("Request region info: {Diagnostics}", diagnostics);
// Check contacted regions, failovers in diagnostics
```

Best practices:
- List closest region first
- Include at least 2 regions for redundancy
- Match regions with your account's replicated regions
- Use Azure region constants (Regions.WestUS2) for correctness

Reference: [Configure preferred regions](https://learn.microsoft.com/azure/cosmos-db/nosql/tutorial-global-distribution)
