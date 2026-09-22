---
title: Compute min/max/avg with one scoped aggregate query
impact: HIGH
impactDescription: prevents incorrect stats from partial reads or mismatched filters
tags: query, aggregate, min, max, avg, correctness, performance
---

## Compute min/max/avg with one scoped aggregate query

For endpoint statistics, compute `MIN`, `MAX`, and `AVG` from the same filtered dataset in a single Cosmos DB query whenever possible. Avoid mixing values from separate queries, partial pages, or different time windows, which produces mathematically inconsistent results.

**Incorrect (client-side aggregation over partial or inconsistent data):**

```java
// ❌ Reads only first page and computes stats from incomplete data
CosmosPagedIterable<JsonNode> page = container.queryItems(
    "SELECT * FROM c WHERE c.deviceId = @deviceId",
    new CosmosQueryRequestOptions(),
    JsonNode.class
);

List<JsonNode> docs = page.stream().limit(50).toList(); // arbitrary subset
double min = docs.stream().mapToDouble(d -> d.get("temperature").asDouble()).min().orElse(0);
double max = docs.stream().mapToDouble(d -> d.get("temperature").asDouble()).max().orElse(0);
double avg = docs.stream().mapToDouble(d -> d.get("temperature").asDouble()).average().orElse(0);
```

```python
# ❌ Different filters per metric cause inconsistent results
min_q = "SELECT VALUE MIN(c.humidity) FROM c WHERE c.deviceId = @id"
max_q = "SELECT VALUE MAX(c.humidity) FROM c WHERE c.deviceId = @id AND c.timestamp > @start"
avg_q = "SELECT VALUE AVG(c.humidity) FROM c WHERE c.deviceId = @id AND c.timestamp > @start"
```

**Correct (single-pass aggregate query with consistent filters):**

```java
// ✅ One query, one filter set, consistent aggregate outputs
String sql = """
    SELECT
      MIN(c.temperature) AS minTemp,
      MAX(c.temperature) AS maxTemp,
      AVG(c.temperature) AS avgTemp,
      MIN(c.humidity) AS minHumidity,
      MAX(c.humidity) AS maxHumidity,
      AVG(c.humidity) AS avgHumidity
    FROM c
    WHERE c.deviceId = @deviceId
      AND c.timestamp >= @start
      AND c.timestamp <= @end
    """;
```

```python
# ✅ Use one scoped aggregate query
query = """
SELECT
  MIN(c.value) AS minValue,
  MAX(c.value) AS maxValue,
  AVG(c.value) AS avgValue
FROM c
WHERE c.entityId = @id AND c.timestamp >= @start AND c.timestamp <= @end
"""
```

Use a partition key aligned with the aggregation scope (for example, per-entity/per-device stats) so the query stays efficient and predictable.

Reference: [Aggregate functions in Azure Cosmos DB for NoSQL](https://learn.microsoft.com/azure/cosmos-db/nosql/query/aggregate-functions) | [Query performance tips](https://learn.microsoft.com/azure/cosmos-db/nosql/performance-tips-query-sdk)
