---
title: Use the Patch API for atomic counter increments
impact: HIGH
impactDescription: avoids a separate read for counters and eliminates read-modify-write concurrency conflicts
tags:
  - sdk
  - patch
  - java
  - counter
  - atomic
  - ru-cost
---

## Use the Patch API for Atomic Counter Increments

**Impact: HIGH (avoids a separate read for counters and eliminates read-modify-write concurrency conflicts)**

For fields that act as counters (view counts, rating totals, like counts), `patchItem` with `CosmosPatchOperations.increment()` performs a server-side atomic increment without a prior read. This avoids the extra read round-trip and its RU charge, and is free of the read-modify-write ETag conflict/retry cycle. The patch write itself still consumes RUs; do not assume a fixed charge or that it is significantly cheaper than replacing the item.

**Incorrect (read-modify-write for counters):**

```java
// ❌ Read-modify-write incurs separate read and write charges, subject to ETag conflicts at scale
CosmosItemResponse<Video> resp = container.readItem(videoId,
    new PartitionKey(videoId), Video.class).block();
Video video = resp.getItem();
video.setViews(video.getViews() + 1);
container.upsertItem(video, new PartitionKey(videoId), null).block();
```

**Correct (Patch API — server-side atomic increment):**

```java
// ✅ Atomic increment — no read required, no ETag conflict possible
CosmosPatchOperations ops = CosmosPatchOperations.create()
    .increment("/views", 1);      // Atomic add, server-side

container.patchItem(
    videoId,
    new PartitionKey(videoId),
    ops,
    Video.class
).block();
```

```java
// ✅ Patch multiple counters in one round-trip (e.g., rate-video: two fields)
CosmosPatchOperations ratingOps = CosmosPatchOperations.create()
    .increment("/ratingsCount", 1)
    .increment("/ratingsTotal", ratingValue);

videosContainer.patchItem(
    videoId, new PartitionKey(videoId), ratingOps, Video.class).block();
```

```java
// ✅ Async / reactive
CosmosPatchOperations ops = CosmosPatchOperations.create().increment("/views", 1);

return container.patchItem(videoId, new PartitionKey(videoId), ops, Video.class)
    .then();  // Mono<Void> — caller doesn't need the updated document
```

**Patch operations supported:**
- `increment(path, value)` — numeric increment (positive or negative)
- `set(path, value)` — set a field to a new value
- `add(path, value)` — add to an array or set a field
- `remove(path)` — remove a field
- `replace(path, value)` — replace an existing field (fails if absent)
- `move(from, to)` — rename a field

**Key Points:**
- `increment(path, value)` creates a missing object field with the specified value. An existing target must be numeric. Parent objects must already exist; increment does not create missing ancestors.
- At most 10 patch operations per `patchItem` call
- Patch is idempotent for `set`/`replace` but **not** for `increment` — a retried increment will double-count. Use conditional patch (`setFilterPredicate`) or accept the retry risk for high-volume counters
- RU cost varies with item size, the update, and indexing policy. Patch is billed like other database operations, not as a fixed 1-RU write. It avoids a separate application read; measure the patch response with `CosmosItemResponse.getRequestCharge()` to evaluate actual costs.
- Prefer Patch over Stored Procedures for simple counter increments — Patch is natively supported without custom server-side code

References: [Supported patch operations](https://learn.microsoft.com/azure/cosmos-db/partial-document-update#supported-operations), [Patch troubleshooting](https://learn.microsoft.com/azure/cosmos-db/partial-document-update-getting-started#troubleshooting), [Patch RU pricing](https://learn.microsoft.com/azure/cosmos-db/partial-document-update-faq#how-is-ru-s-pricing-calculated-), [read/write cost factors](https://learn.microsoft.com/azure/cosmos-db/optimize-cost-reads-writes)
