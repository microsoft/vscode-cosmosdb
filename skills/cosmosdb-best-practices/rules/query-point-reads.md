---
title: Use Point Reads Instead of Queries for Known ID and Partition Key
impact: HIGH
impactDescription: 1 RU vs ~2.5 RU per single-document lookup
tags: query, point-read, ReadItem, ReadMany, performance, optimization
---

## Use Point Reads Instead of Queries for Known ID and Partition Key

When both the document `id` and partition key value are known, use a point read (`ReadItemAsync` / `read_item` / `readItem`) instead of a query. A point read costs 1 RU for a 1 KB document and bypasses the query engine entirely. An equivalent `SELECT * FROM c WHERE c.id = @id` query costs ~2.5 RU because the query engine still parses, optimizes, and executes even though the result is a single document.

**Incorrect (query when both id and partition key are known):**

```csharp
// ❌ Uses query engine when a point read would suffice
var query = new QueryDefinition("SELECT * FROM c WHERE c.id = @id")
    .WithParameter("@id", orderId);

var iterator = container.GetItemQueryIterator<Order>(query,
    requestOptions: new QueryRequestOptions
    {
        PartitionKey = new PartitionKey(customerId)
    });

var response = await iterator.ReadNextAsync();
return response.FirstOrDefault();
// Cost: ~2.5 RU for a 1 KB document (query engine overhead)
```

```python
# ❌ Query instead of point read
def get_player(self, player_id: str, game_id: str):
    query = "SELECT * FROM c WHERE c.id = @id"
    items = list(self.container.query_items(
        query=query,
        parameters=[{"name": "@id", "value": player_id}],
        partition_key=game_id
    ))
    return items[0] if items else None
    # Unnecessary query engine invocation
```

```typescript
// ❌ Query instead of point read — id and partition key both known
const { resources } = await container.items
  .query<Order>({
    query: 'SELECT * FROM c WHERE c.id = @id',
    parameters: [{ name: '@id', value: orderId }],
  }, { partitionKey: userId })
  .fetchAll();
return resources[0] ?? null;
// ~2.92 RU — goes through the query engine for a single known document
```

**Correct (point read — bypasses query engine):**

```csharp
// ✅ Point read — 1 RU for a 1 KB document, no query engine overhead
var response = await container.ReadItemAsync<Order>(
    orderId,
    new PartitionKey(customerId));
return response.Resource;
```

```python
# ✅ Point read — 1 RU, no query engine overhead
def get_player(self, player_id: str, game_id: str):
    return self.container.read_item(item=player_id, partition_key=game_id)
```

```java
// ✅ Point read in Java SDK
CosmosItemResponse<Order> response = container.readItem(
    orderId,
    new PartitionKey(customerId),
    Order.class);
return response.getItem();
```

```typescript
// ✅ Point read in Node.js — 1 RU, no query engine overhead
const { resource: order } = await container.item(orderId, userId).read<Order>();
return order ?? null;
```

```rust
// ✅ Point read in Rust (azure_data_cosmos) — 1 RU, no query engine
use azure_data_cosmos::PartitionKey;

let container = cosmos.database_client("db").container_client("orders").await;
let pk = PartitionKey::from(customer_id.to_string());
let response = container.read_item::<serde_json::Value>(pk, &order_id, None).await;
match response {
    Ok(item) => {
        let order: Order = serde_json::from_value(item.into_body()).unwrap();
        // Cost: 1 RU for a 1 KB document
    }
    Err(e) if e.http_status() == Some(azure_core::http::StatusCode::NotFound) => {
        // Document not found
    }
    Err(e) => return Err(e),
}
```

```go
// ❌ Query instead of point read (Go SDK)
func GetOrder(container *azcosmos.ContainerClient, customerID string, orderID string) (Order, error) {
    pk := azcosmos.NewPartitionKeyString(customerID)

    query := azcosmos.NewQueryDefinition("SELECT * FROM c WHERE c.id = @id").
        WithParameter("@id", orderID)

    pager := container.NewQueryItemsPager(query, nil)

    ctx := context.Background()
    for pager.More() {
        resp, err := pager.NextPage(ctx)
        if err != nil {
            return Order{}, err
        }

        var orders []Order
        err = json.Unmarshal(resp.Value, &orders)
        if err != nil {
            return Order{}, err
        }

        if len(orders) > 0 {
            return orders[0], nil
        }
    }

    return Order{}, nil
}
```

```go
// ✅ Point read in Go SDK
func GetOrder(container *azcosmos.ContainerClient, customerID string, orderID string) (Order, error) {
    pk := azcosmos.NewPartitionKeyString(customerID)

    response, err := container.ReadItem(
        context.Background(),
        pk,
        orderID,
        nil,
    )
    if err != nil {
        return Order{}, err
    }

    var order Order
    err = json.Unmarshal(response.Value, &order)
    if err != nil {
        return Order{}, err
    }

    return order, nil
}
```

### Multiple Known Documents — ReadMany vs. Parallel Point Reads

When fetching multiple documents by known `(id, partitionKey)` pairs, you have two options:

1. **Client-side parallel point reads** — issue individual `ReadItem` calls concurrently
2. **ReadMany** — batch all `(id, partitionKey)` pairs into a single SDK call

ReadMany targets only the relevant partitions and avoids the query engine, but the performance tradeoff depends on batch size, client resources, and document size. Small batches can be slower than aggressively parallel point reads on a well-provisioned client, while larger batches tend to reduce both latency and RU cost. **Benchmark both approaches** with your actual workload before committing to one.

**⚠️ Avoid using OR/IN queries across partition keys — these fan out to all partitions regardless of how many documents you need:**

```csharp
// ❌ OR/IN clause spanning multiple partition keys — cross-partition fan-out
var query = new QueryDefinition(
    "SELECT * FROM c WHERE c.id IN (@id1, @id2, @id3)")
    .WithParameter("@id1", "order-1")
    .WithParameter("@id2", "order-2")
    .WithParameter("@id3", "order-3");
// Fans out to ALL partitions to find 3 documents — RU scales with partition count
```

**✅ ReadMany — targeted reads, no fan-out (best for larger batches; benchmark for your workload):**

```csharp
// ✅ ReadMany — targets only relevant partitions
var items = new List<(string id, PartitionKey partitionKey)>
{
    ("order-1", new PartitionKey("customer-a")),
    ("order-2", new PartitionKey("customer-b")),
    ("order-3", new PartitionKey("customer-a"))
};

var response = await container.ReadManyItemsAsync<Order>(items);
// Consistent cost — no cross-partition fan-out
```

```python
# ✅ ReadMany in Python SDK
items_to_read = [
    ("order-1", "customer-a"),
    ("order-2", "customer-b"),
    ("order-3", "customer-a")
]
results = container.read_many_items(item_identities=items_to_read)
```

**✅ Parallel point reads — alternative for small batches on well-provisioned clients:**

```csharp
// ✅ Parallel point reads — can outperform ReadMany for small batches
var tasks = new[]
{
    container.ReadItemAsync<Order>("order-1", new PartitionKey("customer-a")),
    container.ReadItemAsync<Order>("order-2", new PartitionKey("customer-b")),
    container.ReadItemAsync<Order>("order-3", new PartitionKey("customer-a"))
};

var responses = await Task.WhenAll(tasks);
```

```typescript
// ❌ OR/IN across partitions — fans out to every partition
const { resources } = await container.items.query<Order>({
  query: 'SELECT * FROM c WHERE c.id IN (@a, @b, @c)',
  parameters: [
    { name: '@a', value: 'order-1' },
    { name: '@b', value: 'order-2' },
    { name: '@c', value: 'order-3' },
  ],
}).fetchAll();

// ✅ Parallel point reads (@azure/cosmos v4 does not expose readMany;
//    use bounded-concurrency parallel reads for batched lookups)
const results = await Promise.all([
  container.item('order-1', 'user-alice').read<Order>(),
  container.item('order-2', 'user-bob').read<Order>(),
  container.item('order-3', 'user-alice').read<Order>(),
]);
return results.map(r => r.resource).filter(Boolean);
// Total RU ≈ N × 1.0; bound concurrency with a limiter for larger batches
```

### Validate parent existence with a point read before writing child records

When writing a child/event document that references a parent entity (for example, reading → device, line item → order), do a parent point read first if your API requires rejecting unknown parents. This keeps referential checks cheap and avoids orphaned documents.

```java
// ✅ Fast referential validation (1 RU point read) before write
try {
    container.readItem(deviceId, new PartitionKey(deviceId), Device.class);
} catch (CosmosException ex) {
    if (ex.getStatusCode() == 404) {
        throw new IllegalArgumentException("Unknown deviceId");
    }
    throw ex;
}
// write telemetry only after parent exists
```

```python
# ❌ No existence check: creates orphan child records
container.upsert_item({"id": event_id, "deviceId": device_id, "value": 42})
```

### When to Use Each Approach

| Scenario | Approach |
|----------|----------|
| Single document with known id and partition key | **ReadItem** (point read) |
| Multiple documents with known (id, partitionKey) pairs — large batch | **ReadMany** (benchmark to confirm) |
| Multiple documents with known (id, partitionKey) pairs — small batch | **Parallel point reads** or **ReadMany** (benchmark both) |
| Need filtering, sorting, projection, or aggregation | **Query** |
| Exact ids and partition keys are not known | **Query** |

Reference: [Point reads in Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/nosql/how-to-read-item) | [ReadMany — read multiple items](https://learn.microsoft.com/azure/cosmos-db/nosql/how-to-dotnet-read-item#read-multiple-items) | [Read many items fast (Java)](https://devblogs.microsoft.com/cosmosdb/read-many-items-fast-with-the-java-sdk-for-azure-cosmos-db/)
