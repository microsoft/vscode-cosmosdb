---
title: Guard against empty continuation tokens before calling byPage
impact: HIGH
impactDescription: empty string token causes runtime "INVALID JSON in continuation token" error; null is the correct sentinel for first-page requests
tags:
  - sdk
  - java
  - pagination
  - continuation-token
  - grpc
  - correctness
---

## Guard Against Empty Continuation Tokens Before Calling byPage

**Impact: HIGH (empty string token causes runtime `INVALID JSON in continuation token` error; `null` is the correct sentinel for first-page requests)**

When integrating Cosmos DB pagination with frameworks that use empty strings as default values for "no token" (e.g., gRPC/proto3, where string fields default to `""`), passing `""` to `byPage(continuationToken, pageSize)` triggers a server-side parse error. The correct sentinel for "no paging state" is `null`.

**Incorrect (empty string passed as continuation token):**

```java
// ❌ gRPC/proto3: string fields default to "" — NOT null
String pagingState = request.getPagingState();  // returns "" on first call

// Passing "" to byPage causes:
// CosmosException: INVALID JSON in continuation token
return container.queryItems(querySpec, opts, Video.class)
    .byPage(pagingState, pageSize)          // ❌ "" is not a valid token
    .next()
    .toFuture();
```

**Correct (null-guard before passing to byPage):**

```java
// ✅ Convert empty string to null before passing as continuation token
String raw = request.getPagingState();     // "" on first call, token on subsequent calls
String continuationToken = (raw == null || raw.isEmpty()) ? null : raw;

return container.queryItems(querySpec, opts, Video.class)
    .byPage(continuationToken, pageSize)   // ✅ null = first page, token = continuation
    .next()
    .map(page -> new ResultListPage<>(page.getResults(), page.getContinuationToken()))
    .switchIfEmpty(Mono.just(new ResultListPage<>()))
    .toFuture();
```

```java
// ✅ Or with Optional pattern
Optional<String> pageState = Optional.ofNullable(
    raw == null || raw.isEmpty() ? null : raw);

return container.queryItems(querySpec, opts, Video.class)
    .byPage(pageState.orElse(null), pageSize)
    .next()
    .toFuture();
```

**General pattern for any pagination layer:**

| Input value | Meaning | Pass to byPage as |
|-------------|---------|------------------|
| `null` | First page | `null` |
| `""` (empty string) | First page (proto3/gRPC default) | `null` |
| `"eyJ..."` (token) | Continuation | Pass as-is |

**Key Points:**
- `byPage(String continuationToken, int pageSize)` — `continuationToken` must be `null` for the first page request, never `""`
- This issue appears in any integration where the paging state field has a non-null empty default: gRPC/proto3 strings, Jackson deserialization of missing JSON fields, HTTP query parameters
- `page.getContinuationToken()` returns `null` when there are no more pages — map `null` back to `""` when sending to clients that expect non-null strings (e.g., proto3 response fields)
- `switchIfEmpty(Mono.just(new ResultListPage<>()))` handles the case where the query matches zero documents and `byPage(...).next()` emits nothing

Reference: [Query with continuation tokens (Java SDK)](https://learn.microsoft.com/azure/cosmos-db/nosql/how-to-java-get-started)
