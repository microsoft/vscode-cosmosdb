---
title: Enable Diagnostic Logging
impact: LOW-MEDIUM
impactDescription: enables troubleshooting
tags: monitoring, diagnostics, logging, troubleshooting
---

## Enable Diagnostic Logging

Enable diagnostic logging to capture detailed operation data for troubleshooting. Essential for root cause analysis of production issues.

**Incorrect (no diagnostic logging):**

```csharp
// When issues occur, you have no data to investigate
// "Why is this query slow?"
// "Why did we get throttled yesterday at 3am?"
// "Which operations are using the most RU?"
// No answers without logging!
```

**Correct (comprehensive diagnostic logging):**

```csharp
// Azure diagnostic settings for detailed logs
// Enable via Azure Portal > Cosmos DB > Diagnostic settings

// Categories to enable:
// 1. DataPlaneRequests - All CRUD operations
// 2. QueryRuntimeStatistics - Query execution details
// 3. PartitionKeyStatistics - Partition key distribution
// 4. PartitionKeyRUConsumption - RU by partition
// 5. ControlPlaneRequests - Management operations

// ARM template for diagnostic settings
{
    "type": "Microsoft.Insights/diagnosticSettings",
    "name": "cosmos-diagnostics",
    "properties": {
        "logs": [
            { "category": "DataPlaneRequests", "enabled": true },
            { "category": "QueryRuntimeStatistics", "enabled": true },
            { "category": "PartitionKeyStatistics", "enabled": true },
            { "category": "PartitionKeyRUConsumption", "enabled": true },
            { "category": "ControlPlaneRequests", "enabled": true }
        ],
        "logAnalyticsDestinationType": "Dedicated",
        "workspaceId": "[resourceId('Microsoft.OperationalInsights/workspaces', 'my-workspace')]"
    }
}
```

```csharp
// Application-level diagnostic logging
public class DiagnosticLoggingRepository
{
    private readonly Container _container;
    private readonly ILogger _logger;
    
    public async Task<T> ExecuteWithDiagnostics<T>(
        string operationName,
        Func<Task<Response<T>>> operation)
    {
        var correlationId = Activity.Current?.Id ?? Guid.NewGuid().ToString();
        
        try
        {
            var response = await operation();
            
            // Always log basic info
            _logger.LogDebug(
                "[{CorrelationId}] {Operation}: {RU} RU, {LatencyMs}ms, Status: {Status}",
                correlationId,
                operationName,
                response.RequestCharge,
                response.Diagnostics.GetClientElapsedTime().TotalMilliseconds,
                "Success");
            
            // Log full diagnostics for slow operations
            if (response.Diagnostics.GetClientElapsedTime() > TimeSpan.FromMilliseconds(100))
            {
                _logger.LogWarning(
                    "[{CorrelationId}] Slow {Operation}: {Diagnostics}",
                    correlationId,
                    operationName,
                    response.Diagnostics.ToString());
            }
            
            return response.Resource;
        }
        catch (CosmosException ex)
        {
            _logger.LogError(ex,
                "[{CorrelationId}] {Operation} failed: Status={Status}, SubStatus={SubStatus}, " +
                "RU={RU}, RetryAfter={RetryAfter}, ActivityId={ActivityId}, Diagnostics={Diagnostics}",
                correlationId,
                operationName,
                ex.StatusCode,
                ex.SubStatusCode,
                ex.RequestCharge,
                ex.RetryAfter,
                ex.ActivityId,
                ex.Diagnostics?.ToString());
            
            throw;
        }
    }
}
```

```csharp
// Query-specific diagnostics
public async Task<List<T>> ExecuteQueryWithDiagnostics<T>(
    string queryName,
    QueryDefinition query,
    QueryRequestOptions options = null)
{
    options ??= new QueryRequestOptions();
    options.PopulateIndexMetrics = true;  // Get index usage info
    
    var results = new List<T>();
    var totalRU = 0.0;
    var pageCount = 0;
    
    var iterator = _container.GetItemQueryIterator<T>(query, requestOptions: options);
    
    while (iterator.HasMoreResults)
    {
        var response = await iterator.ReadNextAsync();
        results.AddRange(response);
        totalRU += response.RequestCharge;
        pageCount++;
        
        // Log index metrics (helps identify missing indexes)
        if (!string.IsNullOrEmpty(response.IndexMetrics))
        {
            _logger.LogDebug(
                "Query '{QueryName}' page {Page} index metrics: {IndexMetrics}",
                queryName, pageCount, response.IndexMetrics);
        }
    }
    
    _logger.LogInformation(
        "Query '{QueryName}': {Count} results, {TotalRU} RU, {Pages} pages",
        queryName, results.Count, totalRU, pageCount);
    
    return results;
}
```

Key diagnostic data to capture:
- Operation name and duration
- RU consumption
- Partition key (for hot partition analysis)
- Full diagnostics for errors/slow operations
- Index metrics for queries
- ActivityId (for Azure support)

Reference: [Diagnostic logging](https://learn.microsoft.com/azure/cosmos-db/monitor-resource-logs)
