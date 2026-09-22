---
title: Use TTL for Automatic Data Expiration
impact: MEDIUM
impactDescription: removes stale data without custom cleanup jobs
tags: model, ttl, expiration, retention, cleanup
---

## Use TTL for Automatic Data Expiration

Use Azure Cosmos DB time to live (TTL) for data that has a natural retention window, such as session tokens, event logs, temporary cache entries, invitations, one-time codes, or short-lived processing state. TTL lets the service expire items automatically instead of requiring a scheduled cleanup job that scans and deletes old records.

TTL is configured in seconds. The expiration countdown is based on the item's last modified timestamp (`_ts`), so updating an item resets its TTL window.

**Incorrect (scheduled cleanup job scans and deletes expired items):**

```csharp
// Anti-pattern: periodic cleanup query scans old items and deletes them one by one.
var query = new QueryDefinition(
    "SELECT * FROM c WHERE c.type = 'session' AND c.expiresAt < @now")
    .WithParameter("@now", DateTimeOffset.UtcNow);

using var iterator = container.GetItemQueryIterator<Session>(query);
while (iterator.HasMoreResults)
{
    foreach (var session in await iterator.ReadNextAsync())
    {
        await container.DeleteItemAsync<Session>(
            session.Id,
            new PartitionKey(session.UserId));
    }
}
```

```json
{
  "id": "session-123",
  "userId": "user-42",
  "type": "session",
  "expiresAt": "2026-06-11T13:00:00Z"
}
```

**Correct (enable TTL and set per-item expiration):**

```csharp
// Enable TTL on the container without a default expiration.
// Items expire only when they include their own ttl value.
await database.DefineContainer("sessions", "/userId")
    .WithDefaultTimeToLive(-1)
    .CreateAsync();

var session = new
{
    id = "session-123",
    userId = "user-42",
    type = "session",
    ttl = 3600, // Expire one hour after the item is created or last modified.
    createdAt = DateTimeOffset.UtcNow
};

await container.CreateItemAsync(session, new PartitionKey(session.userId));
```

```json
{
  "id": "session-123",
  "userId": "user-42",
  "type": "session",
  "ttl": 3600,
  "createdAt": "2026-06-11T12:00:00Z"
}
```

Use the right TTL mode for the retention pattern:

- Leave container TTL unset or `null` when items should never expire automatically.
- Set container `DefaultTimeToLive` to a positive number when every item should expire after the same retention period.
- Set container `DefaultTimeToLive` to `-1` when TTL should be enabled but only specific items should expire.
- Set item-level `ttl` to a positive number to override the container default for that item.
- Set item-level `ttl` to `-1` for items that should not expire in a TTL-enabled container.

TTL is best for automatic retention, not exact scheduling. Expired items stop appearing in query results after the TTL expires, but physical deletion happens asynchronously in the background. In provisioned throughput accounts, TTL deletes use leftover RUs; in serverless accounts, deletes are charged like delete item operations.

Reference: [Time to Live in Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/time-to-live)
