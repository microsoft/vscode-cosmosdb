---
title: Understand Burst Capacity
impact: MEDIUM
impactDescription: handles short traffic spikes
tags: throughput, burst, capacity, spikes
---

## Understand Burst Capacity

Cosmos DB provides burst capacity to handle short traffic spikes above provisioned throughput. Understand how it works to avoid unexpected throttling.

**How burst capacity works:**

```csharp
// Cosmos DB accumulates unused RU/s into a burst bucket
// Maximum burst: 300 seconds worth of provisioned throughput

// Example: 1,000 RU/s provisioned
// - If you use 500 RU/s average, unused 500 RU/s accumulates
// - Maximum burst bucket: 1,000 × 300 = 300,000 RU
// - Allows short spike up to ~1,500 RU/s until bucket depletes

// Visual representation:
// Time:    | Steady | Light | BURST | Steady |
// Usage:   | 1000   | 500   | 2000  | 1000   |
// Burst:   | 0      | +500  | -1000 | 0      |
//          |--------|-------|-------|--------|
// Result:  | OK     | OK    | OK*   | OK     |
// * Uses accumulated burst capacity
```

**Incorrect (relying on burst for sustained load):**

```csharp
// Provisioned 1,000 RU/s but regularly need 1,500 RU/s
var container = await database.CreateContainerAsync(props, throughput: 1000);

// Hoping burst will cover:
// - Hour 1: Burst bucket fills from overnight
// - Hour 2-3: Burst bucket depletes
// - Hour 4+: Throttling (429s) begins!

// Result: Temporary success followed by degraded performance
```

**Correct (provision for actual sustained needs):**

```csharp
// Option 1: Provision for peak sustained load
await database.CreateContainerAsync(props, throughput: 1500);

// Option 2: Use autoscale for variable loads
await database.CreateContainerAsync(
    props,
    throughputProperties: ThroughputProperties.CreateAutoscaleThroughput(
        maxThroughput: 2000));  // Scales 200-2000 RU/s

// Burst is for:
// - Momentary spikes (seconds to a few minutes)
// - NOT for sustained elevated load
```

```csharp
// Monitor burst usage
// Azure Monitor metric: "Normalized RU Consumption"
// - > 100% means using burst capacity
// - Sustained > 100% will lead to throttling

// Detect burst usage in code
var response = await container.ReadItemAsync<Order>(id, pk);
// Check if operation used more than provisioned share
// (Diagnostics contain server-side timing and capacity info)
```

Best practices:
- Use burst for absorbing unexpected short spikes
- Don't rely on burst for regular operation
- Monitor "Normalized RU Consumption" metric
- If regularly > 90%, consider scaling up or using autoscale
- Burst capacity is per partition - hot partitions may throttle even with burst available

Reference: [Burst capacity](https://learn.microsoft.com/azure/cosmos-db/concepts-limits#throughput-limits)
