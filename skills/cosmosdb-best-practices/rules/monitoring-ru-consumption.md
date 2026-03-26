---
title: Track RU Consumption
impact: MEDIUM
impactDescription: enables cost optimization
tags: monitoring, ru, metrics, cost
---

## Track RU Consumption

Monitor Request Unit (RU) consumption to optimize costs and identify inefficient operations. Every operation has an RU cost.

**Incorrect (ignoring RU consumption):**

```csharp
// Operations without tracking cost
public async Task<Order> GetOrder(string orderId, string customerId)
{
    // No visibility into cost
    return await _container.ReadItemAsync<Order>(orderId, new PartitionKey(customerId));
    // Is this costing 1 RU or 100 RU? Unknown!
}
```

**Correct (tracking RU at operation level):**

```csharp
public async Task<Order> GetOrder(string orderId, string customerId)
{
    var response = await _container.ReadItemAsync<Order>(orderId, new PartitionKey(customerId));
    
    // Log RU consumption
    _logger.LogDebug(
        "Read order {OrderId}: {RU} RU, {Latency}ms",
        orderId,
        response.RequestCharge,
        response.Diagnostics.GetClientElapsedTime().TotalMilliseconds);
    
    // Track in metrics/telemetry
    _telemetry.TrackMetric("CosmosDB.ReadItem.RU", response.RequestCharge, 
        new Dictionary<string, string> 
        { 
            { "Operation", "ReadItem" },
            { "Container", "orders" }
        });
    
    return response.Resource;
}
```

```csharp
// Track RU for queries (can be high!)
public async Task<List<Order>> GetCustomerOrders(string customerId)
{
    var query = new QueryDefinition("SELECT * FROM c WHERE c.status = @status")
        .WithParameter("@status", "active");
    
    var totalRU = 0.0;
    var results = new List<Order>();
    
    var iterator = _container.GetItemQueryIterator<Order>(
        query,
        requestOptions: new QueryRequestOptions 
        { 
            PartitionKey = new PartitionKey(customerId),
            PopulateIndexMetrics = true  // Also get index metrics
        });
    
    while (iterator.HasMoreResults)
    {
        var response = await iterator.ReadNextAsync();
        results.AddRange(response);
        totalRU += response.RequestCharge;
        
        // Log per-page RU
        _logger.LogDebug(
            "Query page: {Count} items, {RU} RU, Index: {IndexMetrics}",
            response.Count,
            response.RequestCharge,
            response.IndexMetrics);
    }
    
    // Log total query cost
    _logger.LogInformation(
        "GetCustomerOrders: {Total} items, {TotalRU} total RU",
        results.Count,
        totalRU);
    
    // Alert on expensive queries
    if (totalRU > 100)
    {
        _logger.LogWarning(
            "Expensive query detected: {TotalRU} RU for {Count} items",
            totalRU, results.Count);
    }
    
    return results;
}
```

```csharp
// Middleware to track all operations
public class CosmosDbMetricsHandler : RequestHandler
{
    private readonly IMetricTracker _metrics;
    
    public override async Task<ResponseMessage> SendAsync(
        RequestMessage request, 
        CancellationToken cancellationToken)
    {
        var sw = Stopwatch.StartNew();
        var response = await base.SendAsync(request, cancellationToken);
        sw.Stop();
        
        _metrics.TrackDependency(
            "CosmosDB",
            request.RequestUri.ToString(),
            sw.Elapsed,
            response.IsSuccessStatusCode,
            new Dictionary<string, string>
            {
                { "RU", response.Headers.RequestCharge.ToString() },
                { "StatusCode", response.StatusCode.ToString() }
            });
        
        return response;
    }
}

// Register handler
var client = new CosmosClient(connectionString, new CosmosClientOptions
{
    CustomHandlers = { new CosmosDbMetricsHandler(_metrics) }
});
```

Azure Monitor queries for RU analysis:
```kusto
// Top expensive operations
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.DOCUMENTDB"
| summarize TotalRU = sum(requestCharge_s) by OperationName
| order by TotalRU desc

// RU per partition key (detect hot partitions)
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.DOCUMENTDB"
| summarize TotalRU = sum(requestCharge_s) by partitionKey_s
| order by TotalRU desc
```

Reference: [Monitor RU/s](https://learn.microsoft.com/azure/cosmos-db/monitor-request-unit-usage)
