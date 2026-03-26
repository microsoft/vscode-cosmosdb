---
title: Handle 429 Errors with Retry-After
impact: HIGH
impactDescription: prevents cascading failures
tags: sdk, retry, throttling, resilience
---

## Handle 429 Errors with Retry-After

Properly handle rate limiting (HTTP 429) responses by respecting the Retry-After header. The SDK handles this automatically, but configuration and logging are important.

**Incorrect (ignoring or mishandling throttling):**

```csharp
// Anti-pattern: Retrying immediately without backoff
public async Task<Order> GetOrderWithBadRetry(string orderId, string customerId)
{
    while (true)
    {
        try
        {
            return await _container.ReadItemAsync<Order>(orderId, new PartitionKey(customerId));
        }
        catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.TooManyRequests)
        {
            // WRONG: Immediate retry makes throttling worse!
            continue;
        }
    }
}

// Anti-pattern: Failing immediately on throttling
public async Task<Order> GetOrderWithNoRetry(string orderId, string customerId)
{
    try
    {
        return await _container.ReadItemAsync<Order>(orderId, new PartitionKey(customerId));
    }
    catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.TooManyRequests)
    {
        // WRONG: Failing on transient error
        throw new ApplicationException("Database unavailable");
    }
}
```

**Correct (leverage SDK's built-in retry):**

```csharp
// Configure client with appropriate retry settings
var cosmosClient = new CosmosClient(connectionString, new CosmosClientOptions
{
    // SDK automatically retries 429s up to this many times
    MaxRetryAttemptsOnRateLimitedRequests = 9,
    
    // Maximum total wait time for retries
    MaxRetryWaitTimeOnRateLimitedRequests = TimeSpan.FromSeconds(30),
    
    // Enable automatic retry (on by default)
    EnableTcpConnectionEndpointRediscovery = true
});

// SDK handles 429 automatically with exponential backoff
// respecting the Retry-After header from service
public async Task<Order> GetOrderAsync(string orderId, string customerId)
{
    // No manual retry logic needed!
    return await _container.ReadItemAsync<Order>(
        orderId, 
        new PartitionKey(customerId));
}
```

```csharp
// Log throttling for monitoring and capacity planning
public async Task<Order> GetOrderWithDiagnostics(string orderId, string customerId)
{
    try
    {
        var response = await _container.ReadItemAsync<Order>(
            orderId, 
            new PartitionKey(customerId));
        
        // Log RU consumption for capacity planning
        _logger.LogDebug("Read order {OrderId}: {RU} RU", orderId, response.RequestCharge);
        
        return response.Resource;
    }
    catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.TooManyRequests)
    {
        // This only fires if ALL retries exhausted
        _logger.LogWarning(
            "Throttled after all retries. RetryAfter: {RetryAfter}, Diagnostics: {Diagnostics}",
            ex.RetryAfter,
            ex.Diagnostics);
        
        throw;  // Let it bubble up - caller should handle
    }
}
```

```csharp
// For bulk operations, use Bulk API with built-in throttling management
var bulkOptions = new CosmosClientOptions
{
    AllowBulkExecution = true,
    MaxRetryAttemptsOnRateLimitedRequests = 9,
    MaxRetryWaitTimeOnRateLimitedRequests = TimeSpan.FromSeconds(60)
};

var bulkClient = new CosmosClient(connectionString, bulkOptions);

// Bulk upsert handles throttling automatically
var tasks = items.Select(item => 
    container.UpsertItemAsync(item, new PartitionKey(item.PartitionKey)));
await Task.WhenAll(tasks);
```

Reference: [Handle rate limiting](https://learn.microsoft.com/azure/cosmos-db/nosql/troubleshoot-request-rate-too-large)
