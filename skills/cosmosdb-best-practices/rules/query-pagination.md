---
title: Use Continuation Tokens for Pagination
impact: HIGH
impactDescription: enables efficient large result sets
tags: query, pagination, continuation-token, performance
---

## Use Continuation Tokens for Pagination

Use continuation tokens to paginate through large result sets efficiently. **Never use OFFSET/LIMIT for deep pagination** — it is a common anti-pattern with severe performance implications.

### ⚠️ OFFSET/LIMIT Anti-Pattern

**OFFSET/LIMIT is one of the most common and costly Cosmos DB anti-patterns.** The RU cost of OFFSET scales linearly with the offset value because Cosmos DB must read and discard all skipped documents:

| Page | OFFSET | Documents Scanned | Documents Returned | Relative RU Cost |
|------|--------|-------------------|--------------------|------------------|
| 1 | 0 | 100 | 100 | 1x |
| 10 | 900 | 1,000 | 100 | 10x |
| 100 | 9,900 | 10,000 | 100 | 100x |
| 1,000 | 99,900 | 100,000 | 100 | 1,000x |

This pattern is especially dangerous in **leaderboard** and **feed** scenarios where users page through large result sets.

Use OFFSET/LIMIT only when:
- The total result set is small (< 1,000 items)
- You need random access to a specific page (rare)
- Deep pagination is impossible (e.g., top 100 only)

**Incorrect (OFFSET/LIMIT for pagination):**

```csharp
// ❌ Anti-pattern: OFFSET increases cost linearly with page number
public async Task<List<Product>> GetProductsPage(int page, int pageSize)
{
    // Page 1: Skip 0, Page 100: Skip 9900
    var offset = (page - 1) * pageSize;
    
    // OFFSET must scan and discard all previous items!
    var query = $"SELECT * FROM c ORDER BY c.name OFFSET {offset} LIMIT {pageSize}";
    
    var results = await container.GetItemQueryIterator<Product>(query).ReadNextAsync();
    return results.ToList();
    
    // Page 1: Scans 100 items
    // Page 100: Scans 10,000 items, returns 100
    // RU cost grows linearly with page depth!
}
```

**Correct (continuation token pagination):**

```csharp
public class PagedResult<T>
{
    public List<T> Items { get; set; }
    public string ContinuationToken { get; set; }
    public bool HasMore => !string.IsNullOrEmpty(ContinuationToken);
}

public async Task<PagedResult<Product>> GetProductsPage(
    int pageSize, 
    string continuationToken = null)
{
    var query = new QueryDefinition("SELECT * FROM c ORDER BY c.name");
    
    var options = new QueryRequestOptions
    {
        MaxItemCount = pageSize  // Items per page
    };
    
    var iterator = container.GetItemQueryIterator<Product>(
        query,
        continuationToken: continuationToken,  // Resume from last position
        requestOptions: options);
    
    var response = await iterator.ReadNextAsync();
    
    return new PagedResult<Product>
    {
        Items = response.ToList(),
        ContinuationToken = response.ContinuationToken  // For next page
    };
    
    // Every page costs the same RU regardless of depth!
}

// Usage in API
[HttpGet("products")]
public async Task<IActionResult> GetProducts(
    [FromQuery] int pageSize = 20,
    [FromQuery] string continuationToken = null)
{
    // Decode token if passed as query param (URL-safe encoding)
    var token = continuationToken != null 
        ? Encoding.UTF8.GetString(Convert.FromBase64String(continuationToken))
        : null;
    
    var result = await GetProductsPage(pageSize, token);
    
    // Encode token for URL safety
    var nextToken = result.ContinuationToken != null
        ? Convert.ToBase64String(Encoding.UTF8.GetBytes(result.ContinuationToken))
        : null;
    
    return Ok(new { result.Items, NextPage = nextToken });
}
```

```csharp
// Streaming through all results
public async IAsyncEnumerable<Product> GetAllProducts()
{
    string continuationToken = null;
    
    do
    {
        var page = await GetProductsPage(100, continuationToken);
        
        foreach (var product in page.Items)
        {
            yield return product;
        }
        
        continuationToken = page.ContinuationToken;
    }
    while (continuationToken != null);
}
```

### ⚠️ Unbounded Query Anti-Pattern

**Fetching all results without any pagination is even worse than OFFSET/LIMIT.** This is commonly seen when developers skip pagination entirely, assuming result sets are small. At scale, unbounded queries cause:

- **Excessive RU consumption** — reading thousands of documents in one call
- **Timeouts** — queries exceeding the 5-second execution limit
- **Memory pressure** — loading all results into memory
- **Cascading failures** — high RU consumption triggers 429 throttling for other operations

```java
// ❌ Anti-pattern: No pagination — returns ALL matching documents
public List<Task> getTasksByProject(String tenantId, String projectId) {
    String query = "SELECT * FROM c WHERE c.tenantId = @tenantId " +
                   "AND c.type = 'task' AND c.projectId = @projectId";
    SqlQuerySpec spec = new SqlQuerySpec(query,
        Arrays.asList(new SqlParameter("@tenantId", tenantId),
                      new SqlParameter("@projectId", projectId)));
    // Returns ALL tasks — at 500 tasks/project this is wasteful,
    // at 50,000 tasks/project this causes timeouts
    return container.queryItems(spec, new CosmosQueryRequestOptions(), Task.class)
        .stream().collect(Collectors.toList());
}

// ✅ Correct: Return paginated results with continuation token
public PagedResult<Task> getTasksByProject(
        String tenantId, String projectId,
        int pageSize, String continuationToken) {
    String query = "SELECT * FROM c WHERE c.tenantId = @tenantId " +
                   "AND c.type = 'task' AND c.projectId = @projectId " +
                   "ORDER BY c.createdAt DESC";
    CosmosQueryRequestOptions options = new CosmosQueryRequestOptions();
    options.setMaxBufferedItemCount(pageSize);
    // Use iterableByPage for continuation token support
    CosmosPagedIterable<Task> results = container.queryItems(
        new SqlQuerySpec(query, params), options, Task.class);
    // Process first page only, return continuation token for next page
}
```

**Rule of thumb:** If a query can return more than 100 items, it **must** use pagination.

Reference: [Pagination in Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/nosql/query/pagination)
