---
title: Never share a single CosmosItemRequestOptions instance across multiple createItem calls
impact: HIGH
impactDescription: causes wrong partition key to be sent, producing silent data corruption or 400/404 errors
tags:
  - sdk
  - java
  - request-options
  - concurrency
  - correctness
---

## Never Share a Single CosmosItemRequestOptions Instance Across Multiple createItem Calls

**Impact: HIGH (causes wrong partition key to be sent, producing silent data corruption or 400/404 errors)**

`CosmosItemRequestOptions` is a mutable object. The SDK may mutate the options object internally during request preparation (e.g., stamping the resolved partition key). Reusing the same instance across two `createItem` calls causes the second call to inherit state from the first, resulting in an incorrect partition key being sent to the service.

**Incorrect (shared mutable options — second call sends wrong partition key):**

```java
// ❌ Anti-pattern: one options instance reused for two different createItem calls
CosmosItemRequestOptions options = new CosmosItemRequestOptions()
    .setIfNoneMatchETag("*");

// First call: writes UserCredentials with PK = email
credentialsContainer.createItem(credentials, new PartitionKey(email), options).block();

// Second call: SDK re-uses the mutated options — may send PK = email (WRONG)
// instead of PK = userId, causing misrouted write or silent corruption
usersContainer.createItem(userProfile, new PartitionKey(userId), options).block();
```

**Correct (separate instance per call):**

```java
// ✅ Each createItem gets its own fresh options instance
CosmosItemRequestOptions credsOptions = new CosmosItemRequestOptions()
    .setIfNoneMatchETag("*");
CosmosItemRequestOptions userOptions = new CosmosItemRequestOptions()
    .setIfNoneMatchETag("*");

credentialsContainer
    .createItem(credentials, new PartitionKey(email), credsOptions).block();
usersContainer
    .createItem(userProfile, new PartitionKey(userId), userOptions).block();
```

```java
// ✅ Or construct inline to make sharing structurally impossible
credentialsContainer.createItem(
    credentials, new PartitionKey(email),
    new CosmosItemRequestOptions().setIfNoneMatchETag("*")).block();

usersContainer.createItem(
    userProfile, new PartitionKey(userId),
    new CosmosItemRequestOptions().setIfNoneMatchETag("*")).block();
```

**Key Points:**
- `CosmosItemRequestOptions` is **not thread-safe and not reuse-safe** across different requests
- The bug is especially insidious because: (a) the first call succeeds, (b) the second call may also succeed but route to the wrong partition, (c) the document appears at the wrong partition key value, breaking point reads
- The same rule applies to `CosmosQueryRequestOptions` and `CosmosPatchItemRequestOptions`
- Prefer inline construction (`new CosmosItemRequestOptions()...`) to make accidental sharing impossible by inspection

Reference: [Java SDK createItem](https://learn.microsoft.com/azure/cosmos-db/nosql/how-to-java-get-started)
