---
title: Use IfNoneMatchETag("*") for conditional creates to prevent duplicates
impact: HIGH
impactDescription: prevents duplicate documents on concurrent or retried creates without a prior read
tags:
  - sdk
  - etag
  - concurrency
  - java
  - upsert
  - uniqueness
---

## Use IfNoneMatchETag("*") for Conditional Creates to Prevent Duplicates

**Impact: HIGH (prevents duplicate documents on concurrent or retried creates without a prior read)**

When creating a document that must be unique (e.g., user credentials keyed by email), pass `IfNoneMatchETag("*")` on the `createItem` options. Cosmos DB rejects the write with HTTP 409 Conflict if a document with the same `id` in the same partition already exists, making duplicate detection atomic and free of an extra read.

**Incorrect (upsert silently overwrites existing records):**

```java
// ❌ upsertItem overwrites an existing user-credentials document silently
// A duplicate email gets no error — the old credentials are lost
container.upsertItem(credentialsDto, new PartitionKey(email), null).block();
```

**Correct (conditional create — 409 on duplicate):**

```java
// ✅ createItem with IfNoneMatchETag("*") rejects if the document already exists
CosmosItemRequestOptions options = new CosmosItemRequestOptions()
    .setIfNoneMatchETag("*");  // Reject if any document exists with this id+PK

try {
    credentialsContainer
        .createItem(credentialsDto, new PartitionKey(email), options)
        .block();
} catch (CosmosException ex) {
    if (ex.getStatusCode() == 409) {
        // Email already registered — surface as domain error
        throw new AlreadyExistsException("Email already in use: " + email);
    }
    throw ex;
}
```

```java
// ✅ Reactive chain
credentialsContainer
    .createItem(credentialsDto, new PartitionKey(email),
        new CosmosItemRequestOptions().setIfNoneMatchETag("*"))
    .onErrorMap(CosmosException.class, ex ->
        ex.getStatusCode() == 409
            ? new AlreadyExistsException("Email already in use")
            : ex);
```

**Why `"*"` (wildcard):** In HTTP `If-None-Match: *` semantics, `"*"` means "match any existing document". Combined with `createItem` (not `upsertItem`), the server rejects the write if _any_ document with the same `id` and partition key already exists — regardless of its ETag value.

**Key Points:**
- Use `createItem` + `setIfNoneMatchETag("*")`, never `upsertItem`, when uniqueness is a domain invariant
- The 409 check is done atomically server-side — no extra read RU consumed
- Gated on the document's `id` field + partition key (not arbitrary field values)
- Particularly critical for email-keyed credential stores and idempotent API endpoints

Reference: [Optimistic concurrency in Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/nosql/database-transactions-optimistic-concurrency)
