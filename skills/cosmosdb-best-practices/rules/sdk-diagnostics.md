---
title: Log Diagnostics for Troubleshooting
impact: MEDIUM
impactDescription: enables root cause analysis
tags: sdk, diagnostics, logging, monitoring
---

## Log Diagnostics for Troubleshooting

Capture and log diagnostics from Cosmos DB responses, especially for slow or failed operations. Diagnostics contain crucial information for troubleshooting.

`CosmosException.Diagnostics` (type `CosmosDiagnostics`) is a first-class structured signal the SDK provides for debugging failures (RU spend, latency tails, 429s, region selection, and channel reuse). Demonstrating the pattern is not enough — it must be applied at the point of failure.

**Required (strict syntactic minimum):** Every `catch` block whose declared exception type is `Microsoft.Azure.Cosmos.CosmosException` (or a subclass) **must reference `.Diagnostics` on the caught exception variable somewhere inside the catch-block body** — either by logging it as a structured field, or by attaching it to a re-thrown exception's message/data. A catch block that swallows the exception (e.g., `catch (CosmosException) { }`, or returning `null` / `default` / `new T()`) is a violation unless the block first surfaces `.Diagnostics` (for example, by logging it before returning).

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

```csharp
// Pattern A — log message text only, drop Diagnostics (VIOLATION)
catch (CosmosException ex)
{
    _logger.LogError(ex, "Cosmos call failed: {Message}", ex.Message);
    throw;
}

// Pattern B — re-wrap without surfacing Diagnostics (VIOLATION)
catch (CosmosException ex)
{
    throw new InvalidOperationException($"Cosmos error: {ex.StatusCode}", ex);
}

// Pattern C — bare swallow (VIOLATION)
catch (CosmosException)
{
    return null;
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

Minimal acceptable catch block — `ex.Diagnostics` is the non-negotiable part. `StatusCode`, `ActivityId`, and `RequestCharge` are strongly recommended (`CosmosDiagnostics.ToString()` includes the latter two, but having them as structured fields makes log search trivial):

```csharp
catch (CosmosException ex)
{
    _logger.LogError(ex,
        "Cosmos call failed. StatusCode={Status} ActivityId={ActivityId} " +
        "RequestCharge={RU} Diagnostics={Diagnostics}",
        ex.StatusCode, ex.ActivityId, ex.RequestCharge, ex.Diagnostics);
    throw;
}
```

If you must re-wrap, carry the diagnostics forward so they are not lost:

```csharp
catch (CosmosException ex)
{
    throw new InvalidOperationException(
        $"Cosmos error: {ex.StatusCode}. Diagnostics={ex.Diagnostics}", ex);
}
```

Key diagnostic fields:
- `GetClientElapsedTime()`: Total client-side time
- `RequestCharge`: RU consumed
- Server response time, regions contacted
- Retry information
- Connection information

**Detector (mechanical check):** For each `catch` clause whose declared type binds to `Microsoft.Azure.Cosmos.CosmosException` (or a subclass), verify the block body contains a member access ending in `.Diagnostics` on the caught variable. If absent, flag the catch-block source range. This is expressible as a Roslyn analyzer or a regex over `.cs` files (excluding `bin/`, `obj/`, and test directories).

**Why it matters:** `RequestCharge` and `ActivityId` provide immediate cost/correlation context, and `Diagnostics` provides the detailed timeline, regions contacted, and retry/transient-failure context (on a 429 it also includes retry details). Without diagnostics, the operator loses the detailed information needed to debug the failure. See the throughput / RU rules for why `RequestCharge` matters at observability time, and the retry / 429 handling guidance for why 429 catch blocks must capture diagnostics.

Reference: [Capture diagnostics — Troubleshoot .NET SDK](https://learn.microsoft.com/azure/cosmos-db/nosql/troubleshoot-dotnet-sdk#capture-diagnostics)
