---
title: Configure Partition-Level Circuit Breaker
impact: HIGH
impactDescription: prevents cascading failures, improves write availability
tags: sdk, circuit-breaker, high-availability, resilience, partition, failover
---

## Configure Partition-Level Circuit Breaker

The partition-level circuit breaker (PPCB) enhances availability by tracking unhealthy physical partitions and routing requests away from them. This prevents cascading failures when specific partitions experience issues.

**Incorrect (no circuit breaker, cascading failures):**

```csharp
// Without circuit breaker:
// - Requests to unhealthy partitions keep failing
// - Retry storms amplify the problem
// - Application experiences cascading failures
// - No automatic recovery when partition heals

var client = new CosmosClient(connectionString, new CosmosClientOptions
{
    ApplicationPreferredRegions = new List<string> { "East US", "East US 2" }
});

// If partition P1 in East US is unhealthy:
// - Every request to P1 fails with timeout/503
// - Retries make it worse
// - No automatic failover to East US 2 for that partition
```

**Correct (.NET SDK - partition-level circuit breaker):**

```csharp
// Enable via environment variables (.NET SDK)
// Set these before creating the CosmosClient

// Enable the circuit breaker feature
Environment.SetEnvironmentVariable("AZURE_COSMOS_CIRCUIT_BREAKER_ENABLED", "true");

// Configure thresholds for reads
Environment.SetEnvironmentVariable(
    "AZURE_COSMOS_PPCB_CONSECUTIVE_FAILURE_COUNT_FOR_READS", "10");

// Configure thresholds for writes
Environment.SetEnvironmentVariable(
    "AZURE_COSMOS_PPCB_CONSECUTIVE_FAILURE_COUNT_FOR_WRITES", "5");

// Time before re-evaluating partition health
Environment.SetEnvironmentVariable(
    "AZURE_COSMOS_PPCB_ALLOWED_PARTITION_UNAVAILABILITY_DURATION_IN_SECONDS", "5");

// Background health check interval
Environment.SetEnvironmentVariable(
    "AZURE_COSMOS_PPCB_STALE_PARTITION_UNAVAILABILITY_REFRESH_INTERVAL_IN_SECONDS", "60");

var client = new CosmosClient(connectionString, new CosmosClientOptions
{
    ApplicationPreferredRegions = new List<string> { "East US", "East US 2", "West US" }
});

// Now if partition P1 in East US fails 5+ writes:
// 1. Circuit breaker marks P1 as "Unavailable" in East US
// 2. Requests to P1 automatically route to East US 2
// 3. Background thread monitors P1 for recovery
// 4. When P1 heals, circuit closes and East US serves P1 again
```

**Correct (Java SDK - partition-level circuit breaker):**

```java
// Enable via system properties (Java SDK)
// Requires SDK version 4.63.0+

System.setProperty(
    "COSMOS.PARTITION_LEVEL_CIRCUIT_BREAKER_CONFIG",
    "{\"isPartitionLevelCircuitBreakerEnabled\": true, " +
    "\"circuitBreakerType\": \"CONSECUTIVE_EXCEPTION_COUNT_BASED\"," +
    "\"consecutiveExceptionCountToleratedForReads\": 10," +
    "\"consecutiveExceptionCountToleratedForWrites\": 5}");

// Configure background health check interval
System.setProperty(
    "COSMOS.STALE_PARTITION_UNAVAILABILITY_REFRESH_INTERVAL_IN_SECONDS", "60");

// Configure how long a partition can remain unavailable before retry
System.setProperty(
    "COSMOS.ALLOWED_PARTITION_UNAVAILABILITY_DURATION_IN_SECONDS", "30");

CosmosAsyncClient client = new CosmosClientBuilder()
    .endpoint("<endpoint>")
    .key("<key>")
    .preferredRegions(Arrays.asList("East US", "East US 2", "West US"))
    .buildAsyncClient();
```

**Correct (Python SDK - partition-level circuit breaker):**

```python
import os
from azure.cosmos import CosmosClient

# Enable via environment variables (Python SDK)
# Requires SDK version 4.14.0+

os.environ["AZURE_COSMOS_ENABLE_CIRCUIT_BREAKER"] = "true"
os.environ["AZURE_COSMOS_CONSECUTIVE_ERROR_COUNT_TOLERATED_FOR_READ"] = "10"
os.environ["AZURE_COSMOS_CONSECUTIVE_ERROR_COUNT_TOLERATED_FOR_WRITE"] = "5"
os.environ["AZURE_COSMOS_FAILURE_PERCENTAGE_TOLERATED"] = "90"

client = CosmosClient(
    url=HOST,
    credential=MASTER_KEY,
    preferred_locations=['East US', 'East US 2', 'West US']
)

# Circuit breaker state machine:
# Healthy → (failures) → Unhealthy Tentative → (more failures) → Unhealthy
# Unhealthy → (backoff) → Healthy Tentative → (probe success) → Healthy
# Unhealthy → (backoff) → Healthy Tentative → (probe fails) → Unhealthy
```

**How Circuit Breaker Works:**

```
                    ┌─────────────────────────────────────┐
                    │           HEALTHY                   │
                    │   (Normal operation)                │
                    └────────────┬────────────────────────┘
                                 │ Consecutive failures > threshold
                                 ▼
                    ┌─────────────────────────────────────┐
                    │     UNHEALTHY TENTATIVE             │
                    │ (Short-circuit for 1 minute)        │
                    └────────────┬────────────────────────┘
                                 │ More failures OR timeout
                                 ▼
                    ┌─────────────────────────────────────┐
                    │         UNHEALTHY                   │
                    │ (Route to other regions)            │
                    └────────────┬────────────────────────┘
                                 │ Backoff period expires
                                 ▼
                    ┌─────────────────────────────────────┐
                    │      HEALTHY TENTATIVE              │
                    │  (Test probe requests)              │
                    └────────────┬───────────┬────────────┘
                     Success     │           │ Failure
                                 ▼           ▼
                    ┌────────────┐  ┌────────────────────┐
                    │  HEALTHY   │  │    UNHEALTHY       │
                    └────────────┘  └────────────────────┘
```

**Important Requirements:**

| SDK | Minimum Version | Account Type |
|-----|-----------------|--------------|
| .NET | 3.37.0+ | Multi-region (single or multi-write) |
| Java | 4.63.0+ | Multi-region write accounts only |
| Python | 4.14.0+ | Multi-region (single or multi-write) |

**Trade-offs vs Availability Strategy:**

| Feature | Circuit Breaker | Availability Strategy |
|---------|-----------------|----------------------|
| Extra RU cost | None | Yes (parallel requests) |
| Latency reduction | After failures occur | Proactive (threshold-based) |
| Best for | Write-heavy workloads | Read-heavy workloads |
| Initial failures | Some requests fail first | Hedged immediately |

**Best Practice: Combine Both Strategies**

```csharp
// Use BOTH for maximum resilience
Environment.SetEnvironmentVariable("AZURE_COSMOS_CIRCUIT_BREAKER_ENABLED", "true");

var client = new CosmosClientBuilder("connection string")
    .WithApplicationPreferredRegions(new List<string> { "East US", "East US 2", "West US" })
    .WithAvailabilityStrategy(
        AvailabilityStrategy.CrossRegionHedgingStrategy(
            threshold: TimeSpan.FromMilliseconds(500),
            thresholdStep: TimeSpan.FromMilliseconds(100)))
    .Build();

// Circuit breaker handles sustained partition failures
// Availability strategy handles latency spikes
```

Reference: [Performance tips - .NET SDK Circuit Breaker](https://learn.microsoft.com/en-us/azure/cosmos-db/performance-tips-dotnet-sdk-v3#partition-level-circuit-breaker)
Reference: [Performance tips - Java SDK Circuit Breaker](https://learn.microsoft.com/en-us/azure/cosmos-db/performance-tips-java-sdk-v4#partition-level-circuit-breaker)
Reference: [Performance tips - Python SDK Circuit Breaker](https://learn.microsoft.com/en-gb/azure/cosmos-db/performance-tips-python-sdk#partition-level-circuit-breaker)
