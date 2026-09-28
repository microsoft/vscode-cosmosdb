---
title: Rate-Control High-Volume Ingestion
impact: HIGH
impactDescription: prevents sustained 429s and noisy-neighbor latency
tags: sdk, ingestion, bulk, throttling, retry-after, backpressure, java, spark, throughput-control, throughput-buckets, priority-based-execution
---

## Rate-Control High-Volume Ingestion

Write-heavy batch or bulk ingestion can push a container past its provisioned throughput faster than it can absorb, causing sustained 429s and latency spikes for other request paths sharing the same container. Scaling RU/s is sometimes necessary, but application-side rate control is the code lever that keeps ingestion stable: cap concurrent writes, honor the server's `x-ms-retry-after-ms` hint on 429, use the SDK's bulk/throughput-control features, and smooth producers through a queue.

**Incorrect (unbounded concurrent ingestion that amplifies throttling):**

```python
import asyncio

async def ingest(container, documents):
    # Fires every write at once; on 429 the naive retries pile on more pressure.
    await asyncio.gather(*[
        container.upsert_item(doc) for doc in documents
    ])
```

**Correct (bounded concurrency with retry-after-aware writes):**

```python
import asyncio
from azure.cosmos.exceptions import CosmosHttpResponseError

async def upsert_with_backoff(container, doc, limiter, max_attempts=10):
    async with limiter:
        for attempt in range(max_attempts):
            try:
                return await container.upsert_item(doc)
            except CosmosHttpResponseError as ex:
                if ex.status_code != 429 or attempt == max_attempts - 1:
                    raise  # bounded: give up after max_attempts instead of looping forever
                delay_ms = int(ex.headers.get("x-ms-retry-after-ms", "1000"))
                await asyncio.sleep(delay_ms / 1000)

async def ingest(container, documents, batch_size=1000):
    limiter = asyncio.Semaphore(50)                    # cap concurrent writes
    for i in range(0, len(documents), batch_size):     # process in batches — don't create every task at once
        batch = documents[i:i + batch_size]
        await asyncio.gather(*[
            upsert_with_backoff(container, doc, limiter) for doc in batch
        ])
```

Additional levers:
- Prefer the SDK's built-in **throughput control** over hand-rolled fan-out — it caps a workload's RU usage so a bulk job can't starve other traffic (Java SDK and Spark connector shown below). Note that .NET's bulk mode (`AllowBulkExecution`) improves ingestion *efficiency* but does **not** enforce an RU/s cap — pair it with bounded concurrency/backpressure or throughput control.
- Separate batch ingestion paths from latency-sensitive request paths (different clients, or a queue) so a bulk job cannot starve interactive traffic.
- Scaling RU/s can complement rate control, but it does not replace it — a burst can still outrun any fixed provisioning.

### Java SDK: throughput control groups

The Java SDK v4 (>= 4.13.0) has built-in **throughput control groups** that cap RU consumption. Use a *local* group to limit a single client, or a *global* group to coordinate one limit across many client instances via a shared metadata container. (These APIs are annotated `@Beta`.)

**Local (limit ingestion to a share of the container's RU/s within one client):**

```java
ThroughputControlGroupConfig groupConfig =
    new ThroughputControlGroupConfigBuilder()
        .groupName("ingestion")
        .targetThroughputThreshold(0.5) // 50% of provisioned RU/s; or .targetThroughput(5000) for an absolute RU/s cap
        .build();

container.enableLocalThroughputControlGroup(groupConfig);
// All operations on `container` in this client are now rate-limited to the group.
```

**Global (enforce one collective limit across many microservice/worker instances):**

```java
ThroughputControlGroupConfig groupConfig =
    new ThroughputControlGroupConfigBuilder()
        .groupName("ingestion")
        .targetThroughputThreshold(0.5)
        .defaultControlGroup(true)
        .build();

// Metadata container coordinates usage across clients (its partition key is "/groupId").
GlobalThroughputControlConfig globalControlConfig =
    client.createGlobalThroughputControlConfigBuilder(
            "ThroughputControlDatabase", "ThroughputControlContainer")
        .setControlItemRenewInterval(Duration.ofSeconds(5))
        .setControlItemExpireInterval(Duration.ofSeconds(11))
        .build();

container.enableGlobalThroughputControlGroup(groupConfig, globalControlConfig);
```

### Spark connector: throughput control

For bulk data movement with the Cosmos DB Spark connector, enable throughput control so the job caps its RU usage and leaves headroom for other workloads. First create a throughput-control metadata container (partition key `/groupId`, TTL enabled), then set the config on the job:

```scala
"spark.cosmos.throughputControl.enabled" -> "true",
"spark.cosmos.throughputControl.name" -> "ingestion",
"spark.cosmos.throughputControl.targetThroughputThreshold" -> "0.95", // 95% of provisioned RU/s
"spark.cosmos.throughputControl.globalControl.database" -> "database-v4",
"spark.cosmos.throughputControl.globalControl.container" -> "ThroughputControl"
```

Notes:
- On **serverless** accounts a percentage threshold isn't supported — set an absolute cap via `spark.cosmos.throughputControl.targetThroughput` instead.
- With Microsoft Entra ID auth, `targetThroughputThreshold` requires the `.../containers/throughputSettings/read` data action so the connector can read the container's provisioned throughput.

### Server-side isolation: throughput buckets and priority-based execution

The levers above are client-side. Cosmos DB also has two **server-side** controls that isolate a bulk ingestion workload from latency-sensitive traffic on the *same* container. Combine either with the retry/backoff shown earlier so the throttled ingestion path yields instead of failing.

**Priority-based execution (PBE)** — tag requests `High` or `Low`; when the container exceeds its RU/s, Cosmos DB throttles **low-priority requests first** (best-effort, no SLA) and the SDK retries them per its retry policy. Run ingestion at low priority so it backs off under contention while the app's high-priority traffic proceeds. Enable it on the account (portal **Features**, or `az cosmosdb update --enable-priority-based-execution true`). Unspecified requests default to **High**.

```csharp
// .NET v3 (>= 3.38.0): run bulk ingestion at low priority
var ingest = new ItemRequestOptions { PriorityLevel = PriorityLevel.Low };
await container.CreateItemAsync(doc, new PartitionKey(doc.PartitionKey), ingest);
// The app's user-facing reads/writes use PriorityLevel.High and win under contention.
```

```java
// Java v4 (>= 4.45.0): a low-priority throughput-control group, referenced per request
ThroughputControlGroupConfig low = new ThroughputControlGroupConfigBuilder()
    .groupName("ingestion").priorityLevel(PriorityLevel.LOW).build();
container.enableLocalThroughputControlGroup(low);

CosmosItemRequestOptions options = new CosmosItemRequestOptions();
options.setThroughputControlGroupName("ingestion");
```

PBE is **not** supported on serverless accounts and is non-deterministic on shared (database-level) throughput.

**Throughput buckets (preview)** — cap the fraction of a container's RU/s a workload may consume (up to five buckets, each with a maximum percentage). Assign the ingestion job to a bucket so it can never use more than, say, 40% of the container, leaving headroom for the app. Register the preview on the subscription, then configure buckets in Data Explorer (Scale & Settings).

```csharp
// .NET (>= 3.50.0-preview.0): pin all bulk-client requests to bucket 1 (capped in the portal)
CosmosClient client = new CosmosClientBuilder("<endpoint>", credential)
    .WithBulkExecution(true)
    .WithThroughputBucket(1)
    .Build();
// Or per request: new ItemRequestOptions { ThroughputBucket = 1 }
```

```java
// Java (>= 4.75.0): server-side throughput control assigns the container's requests to bucket 1
ThroughputControlGroupConfig bucket = new ThroughputControlGroupConfigBuilder()
    .groupName("ingestion").throughputBucket(1).defaultControlGroup(true).build();
container.enableServerThroughputControlGroup(bucket);
```

References:
- [Bulk import data with the .NET SDK](https://learn.microsoft.com/azure/cosmos-db/nosql/tutorial-dotnet-bulk-import)
- [Throughput control groups — Java SDK v4](https://learn.microsoft.com/azure/cosmos-db/throughput-control-java)
- [Throughput control — Spark connector](https://learn.microsoft.com/azure/cosmos-db/throughput-control-spark)
- [Priority-based execution](https://learn.microsoft.com/azure/cosmos-db/priority-based-execution)
- [Throughput buckets](https://learn.microsoft.com/azure/cosmos-db/throughput-buckets)
