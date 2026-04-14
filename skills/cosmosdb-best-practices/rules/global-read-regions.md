---
title: Add Read Regions Near Users
impact: MEDIUM
impactDescription: reduces read latency globally
tags: global, regions, read-latency, distribution
---

## Add Read Regions Near Users

Add read regions in geographic locations close to your users. Reads can be served from any region, reducing latency for global users.

**Incorrect (single region for global users):**

```csharp
// Only one region configured
// Users from all locations read from single region
// Asia users → 200ms+ latency to US region
// Europe users → 100ms+ latency to US region

{
    "properties": {
        "locations": [
            { "locationName": "West US 2", "failoverPriority": 0 }
        ]
    }
}
```

**Correct (read regions near user populations):**

```csharp
// Add read replicas near major user bases
{
    "type": "Microsoft.DocumentDB/databaseAccounts",
    "properties": {
        "locations": [
            // Primary write region
            { 
                "locationName": "West US 2", 
                "failoverPriority": 0 
            },
            // Read replica for European users
            { 
                "locationName": "West Europe", 
                "failoverPriority": 1 
            },
            // Read replica for Asian users
            { 
                "locationName": "Southeast Asia", 
                "failoverPriority": 2 
            },
            // Read replica for Australian users
            { 
                "locationName": "Australia East", 
                "failoverPriority": 3 
            }
        ]
    }
}
```

```csharp
// Configure SDK for region-local reads
// Deployed in Europe - prioritize European region
var europeClient = new CosmosClient(connectionString, new CosmosClientOptions
{
    ApplicationPreferredRegions = new List<string>
    {
        Regions.WestEurope,      // Nearest region first
        Regions.NorthEurope,     // Backup within Europe
        Regions.WestUS2          // Primary (for writes)
    }
});

// Deployed in Asia - prioritize Asian region
var asiaClient = new CosmosClient(connectionString, new CosmosClientOptions
{
    ApplicationPreferredRegions = new List<string>
    {
        Regions.SoutheastAsia,   // Nearest region first
        Regions.EastAsia,        // Backup within Asia
        Regions.WestUS2          // Primary (for writes)
    }
});
```

```csharp
// Dynamic region selection based on deployment
public static CosmosClient CreateRegionalClient(string connectionString)
{
    var deploymentRegion = Environment.GetEnvironmentVariable("AZURE_REGION") 
        ?? "westus2";
    
    var preferredRegions = deploymentRegion.ToLower() switch
    {
        "westeurope" or "northeurope" => new List<string>
        {
            Regions.WestEurope, Regions.NorthEurope, Regions.WestUS2
        },
        "southeastasia" or "eastasia" => new List<string>
        {
            Regions.SoutheastAsia, Regions.EastAsia, Regions.WestUS2
        },
        "australiaeast" => new List<string>
        {
            Regions.AustraliaEast, Regions.SoutheastAsia, Regions.WestUS2
        },
        _ => new List<string>
        {
            Regions.WestUS2, Regions.EastUS2
        }
    };
    
    return new CosmosClient(connectionString, new CosmosClientOptions
    {
        ApplicationPreferredRegions = preferredRegions
    });
}
```

```csharp
// Verify reads are going to correct region
var response = await container.ReadItemAsync<Order>(orderId, pk);
// Check diagnostics for contacted region
var diagnostics = response.Diagnostics.ToString();
_logger.LogDebug("Request served from: {Diagnostics}", diagnostics);
// Look for "Contacted Region" in diagnostics
```

Cost considerations:
- Each read replica adds cost (~same as primary)
- Calculate: User latency improvement × request volume vs. replica cost
- Start with regions serving most users, add more based on metrics

Reference: [Global distribution](https://learn.microsoft.com/azure/cosmos-db/distribute-data-globally)
