---
title: Alert on Throttling (429s)
impact: HIGH
impactDescription: prevents silent failures
tags: monitoring, throttling, 429, alerts
---

## Alert on Throttling (429s)

Set up alerts for HTTP 429 (Request Rate Too Large) errors. Throttling indicates your application is exceeding provisioned throughput.

**Incorrect (ignoring throttling):**

```csharp
// SDK retries silently, application seems "slow" but no alerts
public async Task<Order> GetOrder(string orderId, string customerId)
{
    // SDK retries 429s automatically (up to 9 times by default)
    // But you have no visibility into this happening!
    return await _container.ReadItemAsync<Order>(orderId, new PartitionKey(customerId));
    // Users experience slow responses, you see nothing in logs
}
```

**Correct (tracking and alerting on throttling):**

```csharp
// Option 1: Track via exception handling
public async Task<Order> GetOrder(string orderId, string customerId)
{
    try
    {
        var response = await _container.ReadItemAsync<Order>(orderId, new PartitionKey(customerId));
        return response.Resource;
    }
    catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.TooManyRequests)
    {
        // This fires only after ALL retries exhausted
        _logger.LogError(
            "Throttled after max retries! RetryAfter: {RetryAfter}s, Diagnostics: {Diagnostics}",
            ex.RetryAfter?.TotalSeconds,
            ex.Diagnostics?.ToString());
        
        _metrics.IncrementCounter("CosmosDB.ThrottledRequests");
        throw;
    }
}

// Option 2: Custom handler to track all 429s (even those retried)
public class ThrottlingTracker : RequestHandler
{
    private readonly ILogger _logger;
    private readonly IMetricTracker _metrics;
    
    public override async Task<ResponseMessage> SendAsync(
        RequestMessage request, 
        CancellationToken cancellationToken)
    {
        var response = await base.SendAsync(request, cancellationToken);
        
        if (response.StatusCode == HttpStatusCode.TooManyRequests)
        {
            _logger.LogWarning(
                "429 Throttled: {Uri}, RetryAfter: {RetryAfter}",
                request.RequestUri,
                response.Headers.RetryAfter);
            
            _metrics.IncrementCounter("CosmosDB.429.Total");
        }
        
        return response;
    }
}

// Register handler
var client = new CosmosClient(connectionString, new CosmosClientOptions
{
    CustomHandlers = { new ThrottlingTracker(_logger, _metrics) }
});
```

```csharp
// Azure Monitor alert rule for throttling
// Create alert in Azure Portal or via ARM:
{
    "type": "Microsoft.Insights/metricAlerts",
    "properties": {
        "criteria": {
            "odata.type": "Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria",
            "allOf": [
                {
                    "name": "TotalRequests429",
                    "metricName": "TotalRequests",
                    "dimensions": [
                        {
                            "name": "StatusCode",
                            "operator": "Include",
                            "values": ["429"]
                        }
                    ],
                    "operator": "GreaterThan",
                    "threshold": 0,
                    "timeAggregation": "Total"
                }
            ]
        },
        "actions": [
            {
                "actionGroupId": "/subscriptions/.../actionGroups/ops-team"
            }
        ],
        "severity": 2,
        "windowSize": "PT5M",
        "evaluationFrequency": "PT1M"
    }
}
```

```kusto
// Log Analytics query for throttling analysis
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.DOCUMENTDB"
| where statusCode_s == "429"
| summarize ThrottledCount = count() by 
    bin(TimeGenerated, 5m),
    partitionKeyRangeId_s,
    OperationName
| order by TimeGenerated desc

// Identify which partition keys are throttling
AzureDiagnostics
| where statusCode_s == "429"
| summarize Count = count() by partitionKey_s
| order by Count desc
| take 10
```

Response to throttling:
1. **Immediate**: SDK retries automatically
2. **Short-term**: Scale up throughput (manual or autoscale)
3. **Long-term**: 
   - Optimize queries to use less RU
   - Review partition key for hot partitions
   - Consider autoscale for variable workloads

Reference: [Monitor throttling](https://learn.microsoft.com/azure/cosmos-db/monitor-normalized-request-units)
