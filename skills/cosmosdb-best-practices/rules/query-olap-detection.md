---
title: Detect and Redirect Analytical Queries Away from Transactional Containers
impact: HIGH
impactDescription: prevents RU starvation, 429 throttling cascades, and query timeouts
tags: query, olap, analytical, aggregation, synapse-link, change-feed, materialized-views
---

## Detect and Redirect Analytical Queries Away from Transactional Containers

**Impact: HIGH (prevents RU starvation, 429 throttling cascades, and query timeouts)**

Cosmos DB's transactional store is optimized for OLTP: point reads, targeted queries within a partition, and bounded result sets. Analytical patterns — COUNT/SUM/AVG across all partitions, GROUP BY over unbounded data, or full-container scans for reporting — consume massive RU, trigger sustained 429 throttling that starves transactional operations, and can exceed the query execution timeout.

Do not run large aggregations, unbounded GROUP BY, or full-container scans against transactional Cosmos DB containers. For analytical workloads, use Azure Synapse Link with analytical store, Change Feed materialized views, or dedicated reporting containers.

Single-partition aggregations scoped to a known partition key with bounded data are acceptable — the concern is unbounded cross-partition scans.

**Correct (enable analytical store and run aggregations via Synapse Link — zero RU impact on transactional store):**

```csharp
// ✅ Enable analytical store on the container
var containerProperties = new ContainerProperties
{
    Id = "orders",
    PartitionKeyPath = "/customerId",
    AnalyticalStoreTimeToLiveInSeconds = -1  // Enable analytical store
};

// ✅ Run aggregations via Synapse Link (no RU consumed on transactional store)
// In Synapse SQL or Spark:
// SELECT region, COUNT(*) as orderCount, SUM(total) as revenue
// FROM cosmos_db.orders WHERE orderDate >= '2025-01-01' GROUP BY region
```

**Correct (pre-compute aggregates incrementally via Change Feed materialized views):**

```csharp
// ✅ Maintain real-time aggregations via Change Feed processor
public class SalesAggregate
{
    public string Id { get; set; }           // "category-electronics"
    public string PartitionKey { get; set; } // "aggregates"
    public string Category { get; set; }
    public long TotalSold { get; set; }
    public decimal AveragePrice { get; set; }
    public DateTime LastUpdated { get; set; }
}

// Dashboard reads pre-computed aggregates: 1 RU per point read
// Instead of recalculating from millions of source documents each time
```

**Correct (single-partition aggregation scoped to a known partition key is acceptable):**

```csharp
// ✅ Bounded, single-partition aggregation — acceptable cost
var query = new QueryDefinition(
    "SELECT VALUE COUNT(1) FROM c WHERE c.customerId = @cid AND c.status = 'pending'")
    .WithParameter("@cid", customerId);

var iterator = container.GetItemQueryIterator<int>(query,
    requestOptions: new QueryRequestOptions
    {
        PartitionKey = new PartitionKey(customerId)  // Scoped to ONE partition
    });
```

**Incorrect (unbounded aggregation across all partitions — fans out to every partition, massive RU):**

```csharp
// ❌ Unbounded aggregation across all partitions
var query = "SELECT c.region, COUNT(1) as orderCount, SUM(c.total) as revenue " +
            "FROM c WHERE c.orderDate >= '2025-01-01' GROUP BY c.region";

var iterator = container.GetItemQueryIterator<dynamic>(query);
// Fans out to ALL partitions, reads ALL matching documents
// At 10M orders: potentially 50,000+ RU per execution
// Blocks transactional traffic with sustained high RU consumption
```

**Incorrect (dashboard refreshing aggregations against transactional store):**

```python
# ❌ Dashboard refreshing aggregations against transactional store
def get_dashboard_metrics(self):
    queries = [
        "SELECT VALUE COUNT(1) FROM c",                           # Full scan
        "SELECT c.status, COUNT(1) FROM c GROUP BY c.status",     # Unbounded GROUP BY
        "SELECT VALUE AVG(c.responseTime) FROM c WHERE c.type = 'request'"  # Cross-partition AVG
    ]
    # Each query scans the entire container
    # Running these every 30 seconds for a dashboard = sustained throttling
```

**Incorrect (reporting query running against operational container):**

```java
// ❌ Reporting query running against operational container
@Query("SELECT c.category, SUM(c.quantity) as totalSold, AVG(c.price) as avgPrice " +
       "FROM c WHERE c.type = 'sale' GROUP BY c.category")
List<CategorySalesReport> getCategorySalesReport();
// Full cross-partition scan + aggregation — hundreds of thousands of RU
// Competes with real-time order processing for the same throughput budget
```

References:
- [Azure Synapse Link for Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/synapse-link)
- [Analytical store overview](https://learn.microsoft.com/azure/cosmos-db/analytical-store-introduction)
- [Change Feed materialized views pattern](https://learn.microsoft.com/azure/cosmos-db/nosql/change-feed-design-patterns#materialized-views)
