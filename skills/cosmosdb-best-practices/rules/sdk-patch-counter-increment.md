---
title: Use the Patch API for atomic counter increments
impact: HIGH
impactDescription: eliminates read-modify-write for counters; reduces RU cost and eliminates concurrency conflicts
tags:
  - sdk
  - patch
  - java
  - counter
  - atomic
  - ru-cost
---

## Use the Patch API for Atomic Counter Increments

**Impact: HIGH (eliminates read-modify-write for counters; reduces RU cost and eliminates concurrency conflicts)**

For fields that act as counters (view counts, rating totals, like counts), `patchItem` with `CosmosPatchOperations.incr()` performs a server-side atomic increment without a prior read. This is cheaper (no read RU), faster, and free of the ETag conflict/retry cycle.

**Incorrect (read-modify-write for counters):**

```java
// ❌ Read-modify-write: 1 read RU + 1 write RU, subject to ETag conflicts at scale
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
- `incr(path, value)` — numeric increment (positive or negative)
- `set(path, value)` — set a field to a new value
- `add(path, value)` — add to an array or set a field
- `remove(path)` — remove a field
- `replace(path, value)` — replace an existing field (fails if absent)
- `move(from, to)` — rename a field

**Key Points:**
- `incr()` requires the field to already exist as a numeric type in the document; initialize it to `0` on document creation
- At most 10 patch operations per `patchItem` call
- Patch is idempotent for `set`/`replace` but **not** for `incr` — a retried increment will double-count. Use conditional patch (`setFilterPredicate`) or accept the retry risk for high-volume counters
- RU cost: ~1 write RU (same as a regular write), no read RU
- Prefer Patch over Stored Procedures for simple counter increments — Patch is natively supported without custom server-side code

Reference: [Partial document update (Patch API)](https://learn.microsoft.com/azure/cosmos-db/partial-document-update)
