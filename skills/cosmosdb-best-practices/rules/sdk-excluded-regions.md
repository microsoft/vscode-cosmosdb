---
title: Configure Excluded Regions for Dynamic Failover
impact: MEDIUM
impactDescription: enables dynamic routing control without code changes
tags: sdk, excluded-regions, high-availability, failover, routing
---

## Configure Excluded Regions for Dynamic Failover

The excluded regions feature enables fine-grained control over request routing by excluding specific regions on a per-request or client basis. This allows dynamic failover without code changes or restarts.

**Incorrect (static region configuration):**

```csharp
// Static configuration requires restart to change routing
var client = new CosmosClient(connectionString, new CosmosClientOptions
{
    ApplicationPreferredRegions = new List<string> { "East US", "West US" }
});

// If East US has issues but isn't fully down:
// - Circuit breaker thresholds may not trigger
// - Manual intervention required
// - Code changes or restart needed to route away
```

**Correct (.NET SDK - excluded regions):**

```csharp
// Configure excluded regions at request level (.NET SDK 3.37.0+)
CosmosClientOptions options = new CosmosClientOptions()
{
    ApplicationPreferredRegions = new List<string> { "West US", "Central US", "East US" }
};

CosmosClient client = new CosmosClient(connectionString, options);
Container container = client.GetDatabase("myDb").GetContainer("myContainer");

// Normal request - uses West US first
await container.ReadItemAsync<dynamic>("item", new PartitionKey("pk"));

// Exclude regions dynamically - bypasses preferred order
await container.ReadItemAsync<dynamic>(
    "item",
    new PartitionKey("pk"),
    new ItemRequestOptions
    {
        ExcludeRegions = new List<string> { "West US", "Central US" }
    });
// This request goes directly to East US
```

```csharp
// Handle rate limiting by routing to alternate regions
ItemResponse<Order> response;
try
{
    response = await container.ReadItemAsync<Order>("id", partitionKey);
}
catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.TooManyRequests)
{
    // Retry in a different region
    response = await container.ReadItemAsync<Order>(
        "id",
        partitionKey,
        new ItemRequestOptions
        {
            ExcludeRegions = new List<string> { "East US" }  // Exclude throttled region
        });
}
```

**Correct (Java SDK - excluded regions):**

```java
// Configure excluded regions with AtomicReference for dynamic updates
CosmosExcludedRegions excludedRegions = new CosmosExcludedRegions(Set.of("East US"));
AtomicReference<CosmosExcludedRegions> excludedRegionsRef = new AtomicReference<>(excludedRegions);

CosmosAsyncClient client = new CosmosClientBuilder()
    .endpoint("<endpoint>")
    .key("<key>")
    .preferredRegions(List.of("West US", "East US"))
    .excludedRegionsSupplier(excludedRegionsRef::get)  // Dynamic supplier
    .buildAsyncClient();

// Update excluded regions without restart
excludedRegionsRef.set(new CosmosExcludedRegions(Set.of("West US")));

// Request-level override
CosmosItemRequestOptions options = new CosmosItemRequestOptions()
    .setExcludedRegions(List.of("East US"));
container.readItem("id", new PartitionKey("pk"), options, JsonNode.class).block();
```

**Correct (Python SDK - excluded regions):**

```python
from azure.cosmos import CosmosClient

# Configure at client level (Python SDK 4.14.0+)
preferred_locations = ['West US 3', 'West US', 'East US 2']
excluded_locations_on_client = ['West US 3', 'West US']

client = CosmosClient(
    url=HOST,
    credential=MASTER_KEY,
    preferred_locations=preferred_locations,
    excluded_locations=excluded_locations_on_client
)

# Request-level override takes highest priority
item = container.read_item(
    item=created_item['id'],
    partition_key=created_item['pk'],
    excluded_locations=['West US 3']  # Override client settings
)
```

**Use Cases:**

| Scenario | Solution |
|----------|----------|
| Region experiencing high latency | Exclude temporarily via request options |
| Rate limiting in specific region | Route to regions with available throughput |
| Planned maintenance | Pre-exclude region before maintenance window |
| Consistency vs availability trade-off | Exclude all but primary for consistent reads |

**Fine-Tuning Consistency vs Availability:**

```csharp
// Steady state: Prioritize consistency (exclude all but primary)
var steadyStateOptions = new ItemRequestOptions
{
    ExcludeRegions = new List<string> { "East US 2", "West US" }  // Only East US (primary)
};

// Outage mode: Prioritize availability (allow cross-region)
var outageOptions = new ItemRequestOptions
{
    ExcludeRegions = new List<string>()  // Empty - use all regions
};
```

Reference: [Performance tips - .NET SDK Excluded Regions](https://learn.microsoft.com/en-us/azure/cosmos-db/performance-tips-dotnet-sdk-v3#excluded-regions)
Reference: [Performance tips - Java SDK Excluded Regions](https://learn.microsoft.com/en-us/azure/cosmos-db/performance-tips-java-sdk-v4#excluded-regions)
