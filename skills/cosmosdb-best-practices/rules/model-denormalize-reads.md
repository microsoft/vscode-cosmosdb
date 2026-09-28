---
title: Denormalize for Read-Heavy Workloads
impact: HIGH
impactDescription: reduces query RU by 2-10x
tags: model, denormalization, read-optimization, performance
---

## Denormalize for Read-Heavy Workloads

In read-heavy workloads, denormalize frequently-queried data to avoid expensive lookups. Accept write overhead for faster reads.

**Incorrect (normalized requires multiple queries):**

```csharp
// Displaying product list with category names
public class Product
{
    public string Id { get; set; }
    public string Name { get; set; }
    public string CategoryId { get; set; }  // Just the ID
    public decimal Price { get; set; }
}

// To display "Product Name - Category Name" requires JOIN-like pattern:
var products = await GetProductsAsync();
foreach (var product in products)
{
    // N+1 query problem!
    var category = await container.ReadItemAsync<Category>(
        product.CategoryId, new PartitionKey(product.CategoryId));
    product.CategoryName = category.Name;
}
// 1 + N queries = terrible performance
```

**Correct (denormalized for read efficiency):**

```csharp
public class Product
{
    public string Id { get; set; }
    public string Name { get; set; }
    public string CategoryId { get; set; }
    
    // Denormalized category info for display
    public string CategoryName { get; set; }
    public string CategorySlug { get; set; }
    
    public decimal Price { get; set; }
}

// Single query returns everything needed for display
var query = "SELECT c.id, c.name, c.categoryName, c.price FROM c WHERE c.type = 'product'";
var products = await container.GetItemQueryIterator<Product>(query).ReadNextAsync();
// No additional queries needed!

// When category changes, update products using Change Feed
public async Task HandleCategoryChange(Category category)
{
    var query = $"SELECT * FROM c WHERE c.categoryId = '{category.Id}'";
    await foreach (var product in container.GetItemQueryIterator<Product>(query))
    {
        product.CategoryName = category.Name;
        await container.UpsertItemAsync(product);
    }
}
```

Denormalize when:
- Read-to-write ratio is high (10:1 or more)
- Denormalized data changes infrequently
- Query patterns benefit from co-located data

*Additional strategies to consider for denormalization*:
**Pre-computed Aggregates** :
   - Definition: When an entity is frequently read and the read response includes aggregated statistics (counts, averages, totals), store those aggregates as persistent document fields rather than computing them per-request
   - When to use:
     - The entity's read response includes derived values such as counts, sums, averages, or min/max
     - Reads significantly outnumber writes (high read-to-write ratio)
     - Computing aggregates on-demand would require COUNT/AVG/SUM queries or application-level iteration
   - Update strategy: Update aggregate fields inline at write time (within the same operation that records new data) or asynchronously via Change Feed
   - Include a `lastUpdated` timestamp field to enable staleness detection

   **Incorrect (aggregates computed on-demand):**

   ```java
   @Container(containerName = "players")
   public class PlayerProfile {
       @Id
       private String id;
       @PartitionKey
       private String playerId;
       private String displayName;
       private int bestScore;
       // No stored aggregates — totalGamesPlayed requires COUNT query,
       // averageScore requires AVG query or app-level computation per request
   }
   ```

   **Correct (pre-computed aggregates stored as fields):**

   ```java
   @Container(containerName = "players")
   public class PlayerProfile {
       @Id
       private String id;
       @PartitionKey
       private String playerId;
       private String displayName;
       private int bestScore;
       private int totalGamesPlayed;   // pre-computed, updated at write time
       private double averageScore;     // pre-computed, updated at write time
       private long lastUpdated;        // timestamp for staleness detection
   }
   ```

   ```csharp
   // Updating aggregates inline at write time
   public async Task RecordGameScore(string playerId, int score)
   {
       var profile = await container.ReadItemAsync<PlayerProfile>(
           playerId, new PartitionKey(playerId));
       var p = profile.Resource;
       p.TotalGamesPlayed += 1;
       p.BestScore = Math.Max(p.BestScore, score);
       p.AverageScore = p.TotalGamesPlayed == 1
           ? score
           : ((p.AverageScore * (p.TotalGamesPlayed - 1)) + score) / p.TotalGamesPlayed;
       p.LastUpdated = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
       await container.ReplaceItemAsync(p, p.Id, new PartitionKey(playerId));
   }
   ```

**Short-Circuit Denormalization** :
   - Definition: Duplicate *only specific fields* (not the full related document) to avoid a cross-partition lookup
   - When to use:
     - The duplicated property is mostly immutable (e.g., product name) or the app can tolerate staleness
     - The property is small (a string, not an object)
     - The access pattern would otherwise require a cross-partition read
   - Example: Copy `customerName` into Order doc to avoid looking up the Customer doc

**Workload-Driven Cost Comparison Template for Denormalization Strategy** :
   ```
   Option 1 — Denormalized:
     Read cost:  [read_RPS] × [RU_per_read] = X RU/s
     Write cost: [write_RPS] × [RU_per_write] + [update_propagation_cost] = Y RU/s
     Total: X + Y RU/s

   Option 2 — Normalized:
     Read cost:  [read_RPS] × ([RU_per_read] + [RU_for_lookup]) = X' RU/s
     Write cost: [write_RPS] × [RU_per_write] = Y' RU/s
     Total: X' + Y' RU/s

   Decision: Choose option with lower total RU/s when workload profile details available
   ```

**Cascade Delete and Update of Denormalized Documents**:

   When a source document is **deleted** or a key field used in denormalized copies is **updated**, all related derived documents in other containers must be updated or removed. Failing to cascade deletes/updates leaves orphaned or stale denormalized data, which causes queries to return ghost entries (deleted entities still appearing in listings) or outdated information (entities appearing under old field values).

   This is one of the most commonly missed patterns: developers implement the source document delete/update correctly but forget to propagate the change to all containers that hold derived documents.

   **Cascade DELETE — remove all related documents when source is deleted:**

   ```python
   # ❌ WRONG — only deletes the source document, orphans derived documents
   async def delete_player(player_id: str):
       await players_container.delete_item(item=player_id, partition_key=player_id)
       # Missing: delete from scores container
       # Missing: delete from leaderboard container
   ```

   ```python
   # ✅ CORRECT — cascade delete across all related containers
   async def delete_player(player_id: str):
       # 1. Delete the source document
       await players_container.delete_item(item=player_id, partition_key=player_id)

       # 2. Delete all related score documents (different container, same partition key)
       scores_query = "SELECT c.id FROM c WHERE c.playerId = @pid"
       async for page in scores_container.query_items(
           query=scores_query, parameters=[{"name": "@pid", "value": player_id}]
       ):
           await scores_container.delete_item(item=page["id"], partition_key=player_id)

       # 3. Delete all leaderboard entries for this player (derived documents)
       lb_query = "SELECT c.id, c.leaderboardKey FROM c WHERE c.playerId = @pid"
       async for entry in leaderboard_container.query_items(
           query=lb_query, parameters=[{"name": "@pid", "value": player_id}],
           enable_cross_partition_query=True,
       ):
           await leaderboard_container.delete_item(
               item=entry["id"], partition_key=entry["leaderboardKey"]
           )
   ```

   ```csharp
   // ✅ CORRECT — .NET cascade delete
   public async Task DeletePlayerAsync(string playerId)
   {
       // 1. Delete source
       await _playersContainer.DeleteItemAsync<Player>(playerId, new PartitionKey(playerId));

       // 2. Delete related scores
       var scoreQuery = new QueryDefinition("SELECT c.id FROM c WHERE c.playerId = @pid")
           .WithParameter("@pid", playerId);
       await foreach (var score in _scoresContainer.GetItemQueryIterator<dynamic>(
               scoreQuery, requestOptions: new QueryRequestOptions { PartitionKey = new PartitionKey(playerId) }))
           await _scoresContainer.DeleteItemAsync<dynamic>(score.id, new PartitionKey(playerId));

       // 3. Delete derived leaderboard entries (enumerate all leaderboard partitions or use cross-partition query)
       var lbQuery = new QueryDefinition("SELECT c.id, c.leaderboardKey FROM c WHERE c.playerId = @pid")
           .WithParameter("@pid", playerId);
       await foreach (var entry in _leaderboardContainer.GetItemQueryIterator<dynamic>(lbQuery))
           await _leaderboardContainer.DeleteItemAsync<dynamic>(
               (string)entry.id, new PartitionKey((string)entry.leaderboardKey));
   }
   ```

   **Cascade UPDATE — re-derive documents when a partitioning field changes:**

   When an entity has a field that determines which partition its derived documents belong to (e.g., a `region` field used as the leaderboard partition key), updating that field requires:
   1. Deleting the old derived documents from the previous partition  
   2. Creating new derived documents in the new partition

   ```python
   # ❌ WRONG — updates player region but leaves stale leaderboard entry in old region
   async def update_player(player_id: str, updates: dict):
       player = await players_container.read_item(item=player_id, partition_key=player_id)
       player.update(updates)
       await players_container.replace_item(item=player_id, body=player)
       # Missing: remove leaderboard entry from old region, add to new region
   ```

   ```python
   # ✅ CORRECT — cascade update when a partition-key field changes
   async def update_player(player_id: str, updates: dict):
       player = await players_container.read_item(item=player_id, partition_key=player_id)
       old_region = player.get("region")
       player.update(updates)
       new_region = player.get("region")
       await players_container.replace_item(item=player_id, body=player)

       if "region" in updates and old_region != new_region:
           # Remove old regional leaderboard entry
           old_key = f"{old_region}_all-time"
           try:
               await leaderboard_container.delete_item(
                   item=player_id, partition_key=old_key
               )
           except Exception:
               pass  # May not exist if player had no scores

           # Re-create in new regional leaderboard if player has scores
           if player.get("bestScore", 0) > 0:
               new_key = f"{new_region}_all-time"
               new_entry = {
                   "id": player_id,
                   "leaderboardKey": new_key,
                   "playerId": player_id,
                   "displayName": player["displayName"],
                   "score": player["bestScore"],
               }
               await leaderboard_container.upsert_item(body=new_entry)
   ```

   **Key rules for cascade operations:**
   - **Every DELETE endpoint** for an entity that has denormalized copies elsewhere must also delete those copies
   - **Every UPDATE endpoint** that changes a field used in derived documents must propagate the change
   - If the updated field is a partition key of the derived container, you must delete-and-recreate (Cosmos DB does not support updating partition key values)
   - Consider listing all containers where derived data lives in a comment near each delete/update handler

Reference: [Denormalization patterns](https://learn.microsoft.com/azure/cosmos-db/nosql/modeling-data#denormalization)
