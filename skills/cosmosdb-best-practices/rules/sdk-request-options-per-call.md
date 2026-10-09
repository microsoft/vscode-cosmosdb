---
title: Use Separate CosmosItemRequestOptions for Deferred or Concurrent Requests
impact: HIGH
impactDescription: avoids partition-key overrides from shared mutable request options
tags:
  - sdk
  - java
  - request-options
  - concurrency
  - correctness
---

## Use Separate CosmosItemRequestOptions for Deferred or Concurrent Requests

**Impact: HIGH (avoids partition-key overrides from shared mutable request options)**

`CosmosItemRequestOptions` is mutable. The Java SDK assigns the supplied partition key to it on every `createItem(item, partitionKey, options)` invocation, before returning the `Mono`. Request preparation reads the captured options when the operation is subscribed. If multiple requests share that object, a later invocation can overwrite its partition key before an earlier request reads it.

Fully awaited sequential `createItem(...).block()` calls do not exhibit this retained-key behavior: the first operation completes before the second invocation assigns its own partition key. The hazard is deferred or overlapping use of shared options, not sequential reuse by itself. Prefer a fresh options instance per operation so the same code remains safe when request scheduling changes.

**Incorrect (both requests capture shared options before either is subscribed):**

```java
import reactor.core.publisher.Mono;

// ❌ Anti-pattern: both deferred requests capture the same mutable options
CosmosItemRequestOptions options = new CosmosItemRequestOptions()
    .setIfNoneMatchETag("*");

// The first invocation sets the key to email but does not subscribe yet
Mono<?> credentialsRequest =
    credentialsContainer.createItem(credentials, new PartitionKey(email), options);

// The second invocation overwrites the shared key with userId
Mono<?> userRequest =
    usersContainer.createItem(userProfile, new PartitionKey(userId), options);

// The first request now reads userId instead of email from the shared options
credentialsRequest.block();
userRequest.block();
```

**Correct (separate instance per call):**

```java
import reactor.core.publisher.Mono;

// ✅ Each createItem gets its own fresh options instance
CosmosItemRequestOptions credsOptions = new CosmosItemRequestOptions()
    .setIfNoneMatchETag("*");
CosmosItemRequestOptions userOptions = new CosmosItemRequestOptions()
    .setIfNoneMatchETag("*");

Mono<?> credentialsRequest =
    credentialsContainer.createItem(credentials, new PartitionKey(email), credsOptions);
Mono<?> userRequest =
    usersContainer.createItem(userProfile, new PartitionKey(userId), userOptions);

credentialsRequest.block();
userRequest.block();
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
- A returned `Mono` retains the options reference, not an immutable snapshot; do not mutate or share it with another operation before the request completes
- Sequential subscriptions alone are not sufficient if both `Mono`s were constructed using shared options before either subscription
- A partition key that differs from the item's partition-key value is rejected with a 400 error; this is not silent relocation of the item to another partition
- Avoid sharing other mutable request-option objects across overlapping operations as well
- Prefer inline construction (`new CosmosItemRequestOptions()...`) to make accidental sharing impossible by inspection

References: [CosmosAsyncContainer API](https://learn.microsoft.com/java/api/com.azure.cosmos.cosmosasynccontainer?view=azure-java-stable), [Java SDK createItem implementation](https://github.com/Azure/azure-sdk-for-java/blob/main/sdk/cosmos/azure-cosmos/src/main/java/com/azure/cosmos/CosmosAsyncContainer.java)
