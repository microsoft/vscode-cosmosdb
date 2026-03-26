---
title: Consider Serverless for Dev/Test
impact: MEDIUM
impactDescription: pay-per-request pricing
tags: throughput, serverless, development, cost
---

## Consider Serverless for Dev/Test

Use serverless accounts for development, testing, and low-traffic workloads. Pay only for actual RU consumption with no minimum commitment.

**Incorrect (provisioned for low traffic):**

```csharp
// Development environment with provisioned throughput
// Minimum 400 RU/s × 24 hours × 30 days = always-on cost
await database.CreateContainerAsync(containerProperties, throughput: 400);

// Problems:
// - Dev environment sits idle 90% of time
// - Still paying for 400 RU/s continuously
// - Multiple dev containers = multiplied waste
```

**Correct (serverless for low/sporadic traffic):**

```csharp
// Create serverless account (at account level, not container)
// No throughput specification - purely consumption-based

// Container creation in serverless account (no throughput parameter)
var containerProperties = new ContainerProperties
{
    Id = "orders",
    PartitionKeyPath = "/customerId"
};

await database.CreateContainerIfNotExistsAsync(containerProperties);
// No throughput = serverless mode

// Cost: Only pay for RUs consumed
// - Idle: $0
// - Light usage: pennies per day
// - Burst: pay for actual consumption
```

```csharp
// Serverless is set at account level, not container
// ARM template for serverless account
{
    "type": "Microsoft.DocumentDB/databaseAccounts",
    "apiVersion": "2021-10-15",
    "name": "my-serverless-account",
    "properties": {
        "databaseAccountOfferType": "Standard",
        "capabilities": [
            {
                "name": "EnableServerless"  // Serverless mode
            }
        ],
        "locations": [
            {
                "locationName": "West US 2"
            }
        ]
    }
}
```

When to use serverless:
- Development and test environments
- Proof of concepts and prototypes
- Low traffic applications (< 5,000 RU/s sustained)
- Sporadic workloads (nightly batch jobs)
- Variable traffic with low baseline

When NOT to use serverless:
- Production with sustained high traffic
- Applications requiring > 5,000 RU/s
- Multi-region deployments (not supported)
- Workloads needing guaranteed throughput

```csharp
// Serverless limitations to be aware of
// - Maximum 5,000 RU/s per container
// - Single region only
// - No dedicated gateway
// - No analytical store (Synapse Link)

// Cost comparison:
// Provisioned 400 RU/s: ~$23/month (always)
// Serverless with 1M RU/month: ~$0.25/month
// Break-even: ~30M RU/month
```

Reference: [Serverless in Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/serverless)
