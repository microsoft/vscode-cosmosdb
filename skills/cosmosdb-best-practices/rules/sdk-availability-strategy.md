---
title: Configure Threshold-Based Availability Strategy (Hedging)
impact: HIGH
impactDescription: reduces tail latency by 90%+, eliminates regional outage impact
tags: sdk, hedging, availability-strategy, high-availability, resilience, cross-region
---

## Configure Threshold-Based Availability Strategy (Hedging)

The threshold-based availability strategy (hedging) improves tail latency and availability by sending parallel read requests to secondary regions when the primary region is slow. This approach drastically reduces the impact of regional outages or high-latency conditions.

**Incorrect (no availability strategy):**

```csharp
// Without availability strategy, slow regions cause high latency for all users
var client = new CosmosClient(connectionString, new CosmosClientOptions
{
    ApplicationPreferredRegions = new List<string> { "East US", "East US 2", "West US" }
});

// If East US is experiencing high latency (e.g., 2 seconds):
// - ALL requests wait the full 2 seconds
// - No automatic failover to faster regions for reads
// - Tail latency spikes affect user experience
var response = await container.ReadItemAsync<Order>(id, partitionKey);
```

**Correct (.NET SDK - availability strategy with hedging):**

```csharp
// Configure threshold-based availability strategy
CosmosClient client = new CosmosClientBuilder("connection string")
    .WithApplicationPreferredRegions(
        new List<string> { "East US", "East US 2", "West US" })
    .WithAvailabilityStrategy(
        AvailabilityStrategy.CrossRegionHedgingStrategy(
            threshold: TimeSpan.FromMilliseconds(500),    // Wait 500ms before hedging
            thresholdStep: TimeSpan.FromMilliseconds(100) // Additional 100ms between regions
        ))
    .Build();

// How it works:
// T1: Request sent to East US (primary)
// T1 + 500ms: If no response, parallel request to East US 2
// T1 + 600ms: If no response, parallel request to West US
// First response wins, others are cancelled
```

```csharp
// Alternative: Configure via CosmosClientOptions
CosmosClientOptions options = new CosmosClientOptions()
{
    AvailabilityStrategy = AvailabilityStrategy.CrossRegionHedgingStrategy(
        threshold: TimeSpan.FromMilliseconds(500),
        thresholdStep: TimeSpan.FromMilliseconds(100)
    ),
    ApplicationPreferredRegions = new List<string> { "East US", "East US 2", "West US" }
};

CosmosClient client = new CosmosClient(
    accountEndpoint: "account endpoint",
    authKeyOrResourceToken: "auth key",
    clientOptions: options);
```

**Correct (Java SDK - threshold-based availability strategy):**

```java
// Proactive Connection Management (warm up connections to failover regions)
CosmosContainerIdentity containerIdentity = new CosmosContainerIdentity("sample_db", "sample_container");
int proactiveConnectionRegionsCount = 2;
Duration aggressiveWarmupDuration = Duration.ofSeconds(1);

CosmosAsyncClient client = new CosmosClientBuilder()
    .endpoint("<account URL>")
    .key("<account key>")
    .endpointDiscoveryEnabled(true)
    .preferredRegions(Arrays.asList("East US", "East US 2", "West US"))
    // Warm up connections to secondary regions for faster failover
    .openConnectionsAndInitCaches(
        new CosmosContainerProactiveInitConfigBuilder(Arrays.asList(containerIdentity))
            .setProactiveConnectionRegionsCount(proactiveConnectionRegionsCount)
            .setAggressiveWarmupDuration(aggressiveWarmupDuration)
            .build())
    .directMode()
    .buildAsyncClient();

// Configure threshold-based availability strategy per request
int threshold = 500;
int thresholdStep = 100;

CosmosEndToEndOperationLatencyPolicyConfig config = 
    new CosmosEndToEndOperationLatencyPolicyConfigBuilder(Duration.ofSeconds(3))
        .availabilityStrategy(new ThresholdBasedAvailabilityStrategy(
            Duration.ofMillis(threshold), 
            Duration.ofMillis(thresholdStep)))
        .build();

CosmosItemRequestOptions options = new CosmosItemRequestOptions();
options.setCosmosEndToEndOperationLatencyPolicyConfig(config);

// Read with hedging enabled
container.readItem("id", new PartitionKey("pk"), options, JsonNode.class).block();

// Writes can benefit too with multi-region write accounts + non-idempotent retry
options.setNonIdempotentWriteRetryPolicy(true, true);
container.createItem(item, new PartitionKey("pk"), options).block();
```

**Trade-offs:**

| Aspect | Benefit | Cost |
|--------|---------|------|
| Latency | 90%+ reduction in tail latency | Extra parallel requests |
| Availability | Preempts regional outages | Increased RU consumption during thresholds |
| Complexity | SDK handles automatically | Configuration tuning required |

**Best Practices:**

1. **Tune threshold based on your P50 latency** - Set threshold slightly above your normal P50 to avoid unnecessary hedging
2. **Use with multi-region accounts** - Requires at least 2 regions configured
3. **Monitor RU consumption** - Track extra RUs during hedging periods
4. **Combine with circuit breaker** - Use both strategies for maximum resilience

Reference: [Performance tips - .NET SDK High Availability](https://learn.microsoft.com/en-us/azure/cosmos-db/performance-tips-dotnet-sdk-v3#high-availability)
Reference: [Performance tips - Java SDK High Availability](https://learn.microsoft.com/en-us/azure/cosmos-db/performance-tips-java-sdk-v4#high-availability)
