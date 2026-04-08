---
title: Use Autoscale for Variable Workloads
impact: HIGH
impactDescription: handles traffic spikes, optimizes cost
tags: throughput, autoscale, scaling, cost
---

## Use Autoscale for Variable Workloads

Use autoscale throughput for workloads with variable or unpredictable traffic patterns. It automatically scales between 10% and 100% of max RU/s.

**Incorrect (fixed throughput for variable workload):**

```csharp
// Fixed provisioned throughput
var containerProperties = new ContainerProperties
{
    Id = "orders",
    PartitionKeyPath = "/customerId"
};

await database.CreateContainerAsync(
    containerProperties,
    throughput: 10000);  // Fixed 10,000 RU/s always

// Problems:
// - Peak hours: 10K RU/s isn't enough → throttling
// - Off-peak: 10K RU/s is wasted → paying for unused capacity
// - Black Friday: Can't handle 50x spike → massive throttling
```

**Correct (autoscale for variable workloads):**

```csharp
// Autoscale with max 10,000 RU/s
var containerProperties = new ContainerProperties
{
    Id = "orders",
    PartitionKeyPath = "/customerId"
};

await database.CreateContainerAsync(
    containerProperties,
    throughputProperties: ThroughputProperties.CreateAutoscaleThroughput(
        maxThroughput: 10000));  // Scales 1,000-10,000 RU/s

// Benefits:
// - Quiet period: Scales down to 1,000 RU/s (10% of max)
// - Busy period: Scales up to 10,000 RU/s automatically
// - No throttling during traffic spikes
// - Pay only for what you use (within autoscale range)
```

```csharp
// Check current autoscale settings
var throughputResponse = await container.ReadThroughputAsync(new RequestOptions());
var autoscaleSettings = throughputResponse.Resource.AutoscaleMaxThroughput;
Console.WriteLine($"Autoscale max: {autoscaleSettings} RU/s");
Console.WriteLine($"Current: {throughputResponse.Resource.Throughput} RU/s");
```

```csharp
// Modify autoscale max throughput
await container.ReplaceThroughputAsync(
    ThroughputProperties.CreateAutoscaleThroughput(maxThroughput: 20000));
// Now scales between 2,000-20,000 RU/s
```

Cost comparison example:
- Fixed 10,000 RU/s: ~$584/month (always)
- Autoscale 10,000 max: $58-$584/month (based on usage)
- If average utilization is 30%, autoscale saves ~70%!

When to use autoscale:
- Variable traffic (peak hours, batch jobs)
- Unpredictable workloads
- Development/test environments
- New applications (unknown traffic patterns)

When to use fixed:
- Steady, predictable workloads (utilization > 66%)
- Cost-sensitive workloads with known patterns

Reference: [Autoscale throughput](https://learn.microsoft.com/azure/cosmos-db/provision-throughput-autoscale)
