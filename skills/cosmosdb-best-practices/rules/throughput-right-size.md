---
title: Right-Size Provisioned Throughput
impact: MEDIUM
impactDescription: balances performance and cost
tags: throughput, provisioning, capacity-planning, cost
---

## Right-Size Provisioned Throughput

Provision throughput based on actual workload needs. Over-provisioning wastes money; under-provisioning causes throttling.

**Incorrect (arbitrary throughput):**

```csharp
// Guessing throughput without analysis
await database.CreateContainerAsync(containerProperties, throughput: 10000);
// "10,000 sounds like a good number"

// Results in:
// - Over-provisioned: Wasting money if actual need is 2,000 RU/s
// - Under-provisioned: Throttling if actual need is 15,000 RU/s
```

**Correct (data-driven provisioning):**

```csharp
// Step 1: Calculate RU requirements

// Point read (by id + partition key): ~1 RU for 1KB item
// Point write: ~5 RU for 1KB item  
// Query: 2.5-10+ RU depending on complexity

// Example calculation:
// - 100 reads/sec × 1 RU = 100 RU/s
// - 50 writes/sec × 5 RU = 250 RU/s
// - 20 queries/sec × 10 RU = 200 RU/s
// - Total: 550 RU/s baseline
// - Add 2x buffer for spikes: 1,100 RU/s
// - Round to minimum: 1,000 RU/s (minimum for manual)

await database.CreateContainerAsync(containerProperties, throughput: 1000);
```

```csharp
// Step 2: Monitor and adjust

// Check RU consumption in code
var response = await container.ReadItemAsync<Order>(id, new PartitionKey(pk));
Console.WriteLine($"Read consumed: {response.RequestCharge} RU");

var queryResponse = await container.GetItemQueryIterator<Order>(query).ReadNextAsync();
Console.WriteLine($"Query consumed: {queryResponse.RequestCharge} RU");

// Monitor via Azure Monitor metrics:
// - Total Request Units: actual consumption
// - Normalized RU Consumption: % of provisioned used
// - 429 Throttling: indicates under-provisioned
```

```csharp
// Step 3: Adjust based on metrics
public async Task AdjustThroughputAsync(Container container)
{
    // Get current throughput
    var current = await container.ReadThroughputAsync();
    
    // Check metrics (would come from Azure Monitor in production)
    var avgUtilization = await GetAverageRUUtilization(container);
    
    if (avgUtilization > 80)
    {
        // Scale up to reduce throttling risk
        var newThroughput = (int)(current.Resource.Throughput * 1.5);
        await container.ReplaceThroughputAsync(newThroughput);
        _logger.LogInformation("Scaled up to {RU} RU/s", newThroughput);
    }
    else if (avgUtilization < 20)
    {
        // Scale down to save cost
        var newThroughput = Math.Max(400, (int)(current.Resource.Throughput * 0.5));
        await container.ReplaceThroughputAsync(newThroughput);
        _logger.LogInformation("Scaled down to {RU} RU/s", newThroughput);
    }
}
```

Throughput guidance:
- Start low, monitor, and adjust
- Target 60-70% average utilization for fixed throughput
- Use autoscale for unpredictable workloads
- Monitor for 429s (throttling indicator)
- Scale before known traffic events (sales, launches)

Reference: [Estimate RU/s](https://learn.microsoft.com/azure/cosmos-db/estimate-ru-with-capacity-planner)
