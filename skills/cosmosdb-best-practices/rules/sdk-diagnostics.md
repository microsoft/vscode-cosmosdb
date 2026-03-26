---
title: Log Diagnostics for Troubleshooting
impact: MEDIUM
impactDescription: enables root cause analysis
tags: sdk, diagnostics, logging, monitoring
---

## Log Diagnostics for Troubleshooting

Capture and log diagnostics from Cosmos DB responses, especially for slow or failed operations. Diagnostics contain crucial information for troubleshooting.

**Incorrect (ignoring diagnostics):**

```csharp
public async Task<Order> GetOrder(string orderId, string customerId)
{
    try
    {
        var response = await _container.ReadItemAsync<Order>(orderId, new PartitionKey(customerId));
        return response.Resource;
    }
    catch (CosmosException ex)
    {
        // Only logging the message loses critical debugging info!
        _logger.LogError("Failed to read order: {Message}", ex.Message);
        throw;
    }
}
```

**Correct (logging diagnostics):**

```csharp
public async Task<Order> GetOrder(string orderId, string customerId)
{
    var response = await _container.ReadItemAsync<Order>(orderId, new PartitionKey(customerId));
    
    // Log diagnostics for slow operations
    if (response.Diagnostics.GetClientElapsedTime() > TimeSpan.FromMilliseconds(100))
    {
        _logger.LogWarning(
            "Slow Cosmos DB read: {ElapsedMs}ms, RU: {RU}, Diagnostics: {Diagnostics}",
            response.Diagnostics.GetClientElapsedTime().TotalMilliseconds,
            response.RequestCharge,
            response.Diagnostics.ToString());
    }
    
    return response.Resource;
}

// For all operations - track RU consumption
public async Task<T> ExecuteWithDiagnostics<T>(
    Func<Task<ItemResponse<T>>> operation,
    string operationName)
{
    var stopwatch = Stopwatch.StartNew();
    
    try
    {
        var response = await operation();
        stopwatch.Stop();
        
        // Always log RU for cost tracking
        _logger.LogDebug(
            "{Operation} completed: {ElapsedMs}ms, {RU} RU",
            operationName,
            stopwatch.ElapsedMilliseconds,
            response.RequestCharge);
        
        // Log full diagnostics if slow or high RU
        if (stopwatch.ElapsedMilliseconds > 100 || response.RequestCharge > 10)
        {
            _logger.LogInformation(
                "{Operation} diagnostics: {Diagnostics}",
                operationName,
                response.Diagnostics.ToString());
        }
        
        return response.Resource;
    }
    catch (CosmosException ex)
    {
        // CRITICAL: Always log diagnostics on failure!
        _logger.LogError(ex,
            "{Operation} failed: Status={Status}, RU={RU}, RetryAfter={RetryAfter}, Diagnostics={Diagnostics}",
            operationName,
            ex.StatusCode,
            ex.RequestCharge,
            ex.RetryAfter,
            ex.Diagnostics?.ToString());
        throw;
    }
}
```

```csharp
// Query diagnostics with query metrics
var queryOptions = new QueryRequestOptions
{
    PopulateIndexMetrics = true,  // Index usage info
    MaxItemCount = 100
};

var iterator = _container.GetItemQueryIterator<Order>(query, requestOptions: queryOptions);
var response = await iterator.ReadNextAsync();

_logger.LogInformation(
    "Query completed: {ItemCount} items, {RU} RU, IndexMetrics: {IndexMetrics}",
    response.Count,
    response.RequestCharge,
    response.IndexMetrics);
// IndexMetrics shows which indexes were used/not used
```

Key diagnostic fields:
- `GetClientElapsedTime()`: Total client-side time
- `RequestCharge`: RU consumed
- Server response time, regions contacted
- Retry information
- Connection information

Reference: [Capture diagnostics](https://learn.microsoft.com/azure/cosmos-db/nosql/troubleshoot-dotnet-sdk)
