---
title: Configure Zone Redundancy for High Availability
impact: HIGH
impactDescription: eliminates availability zone failures, increases SLA to 99.995%
tags: global, zone-redundancy, high-availability, availability-zones, resilience, sla
---

## Configure Zone Redundancy for High Availability

Enable zone redundancy to protect against availability zone failures. Zone-redundant accounts distribute replicas across multiple availability zones within a region.

**Incorrect (no zone redundancy):**

```json
// Single-region account without zone redundancy
// If an availability zone fails:
// - Potential data loss
// - Availability loss until recovery
// - SLA: 99.99%
{
    "type": "Microsoft.DocumentDB/databaseAccounts",
    "properties": {
        "locations": [
            {
                "locationName": "East US",
                "failoverPriority": 0,
                "isZoneRedundant": false  // DEFAULT - no zone protection!
            }
        ]
    }
}
```

**Correct (zone redundancy enabled):**

```json
// ARM template with zone redundancy
{
    "type": "Microsoft.DocumentDB/databaseAccounts",
    "apiVersion": "2023-04-15",
    "name": "my-cosmos-account",
    "properties": {
        "locations": [
            {
                "locationName": "East US",
                "failoverPriority": 0,
                "isZoneRedundant": true  // Enable zone redundancy!
            },
            {
                "locationName": "West US",
                "failoverPriority": 1,
                "isZoneRedundant": true  // Enable in secondary too
            }
        ]
    }
}
```

```bicep
// Bicep template with zone redundancy
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-04-15' = {
  name: 'my-cosmos-account'
  location: 'East US'
  properties: {
    locations: [
      {
        locationName: 'East US'
        failoverPriority: 0
        isZoneRedundant: true  // Replicas spread across 3 AZs
      }
      {
        locationName: 'West US'
        failoverPriority: 1
        isZoneRedundant: true
      }
    ]
    enableAutomaticFailover: true
  }
}
```

**SLA Improvements with Zone Redundancy:**

| Configuration | Write SLA | Read SLA | Zone Failure | Regional Failure |
|--------------|-----------|----------|--------------|------------------|
| Single region, no ZR | 99.99% | 99.99% | Data/availability loss | Data/availability loss |
| Single region + ZR | 99.995% | 99.995% | No loss | Data/availability loss |
| Multi-region, no ZR | 99.99% | 99.999% | Data/availability loss | Dependent on consistency |
| Multi-region + ZR | 99.995% | 99.999% | No loss | Dependent on consistency |
| Multi-region writes + ZR | 99.999% | 99.999% | No loss | No loss (with conflicts) |

**Cost Considerations:**

- Zone redundancy adds **25% premium** to provisioned throughput
- Premium is **waived** for:
  - Multi-region write accounts
  - Autoscale collections
- Adding a region adds ~100% to existing bill

**When to Enable Zone Redundancy:**

1. **Always for single-region accounts** - Primary protection against AZ failures
2. **Write regions in multi-region accounts** - Protects write availability
3. **Production workloads** - Required for high SLA guarantees

**Regions Supporting Zone Redundancy:**

Check current availability: [Azure regions with availability zones](https://learn.microsoft.com/en-us/azure/reliability/availability-zones-service-support)

Reference: [High availability in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db-nosql#availability-zone-support)
