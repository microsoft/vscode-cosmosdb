---
title: Integrate Azure Monitor
impact: MEDIUM
impactDescription: enables comprehensive observability
tags: monitoring, azure-monitor, metrics, logs
---

## Integrate Azure Monitor

Enable Azure Monitor integration for comprehensive visibility into Cosmos DB performance, availability, and cost metrics.

**Incorrect (no monitoring integration):**

```csharp
// Flying blind - no visibility into:
// - RU consumption trends
// - Latency patterns
// - Throttling events
// - Availability issues
// - Cost attribution

// Application runs but you only know about problems from user complaints
```

**Correct (Azure Monitor integration):**

```csharp
// Step 1: Enable diagnostic settings (Azure Portal, CLI, or ARM)
{
    "type": "Microsoft.DocumentDB/databaseAccounts/providers/diagnosticSettings",
    "properties": {
        "logs": [
            {
                "category": "DataPlaneRequests",
                "enabled": true,
                "retentionPolicy": { "enabled": true, "days": 30 }
            },
            {
                "category": "QueryRuntimeStatistics",
                "enabled": true
            },
            {
                "category": "PartitionKeyStatistics",
                "enabled": true
            },
            {
                "category": "PartitionKeyRUConsumption",
                "enabled": true
            }
        ],
        "metrics": [
            {
                "category": "Requests",
                "enabled": true
            }
        ],
        "workspaceId": "/subscriptions/.../workspaces/my-workspace"
    }
}
```

```csharp
// Step 2: Key metrics to monitor in Azure Monitor

// a) Normalized RU Consumption (% of provisioned used)
// Alert if > 90% sustained - indicates need to scale

// b) Total Requests by Status Code
// Alert on 429s (throttling) and 5xx (errors)

// c) Server Side Latency
// Track P50, P99 for performance baselines

// d) Data Usage
// Monitor storage growth

// e) Availability
// Alert on availability drops below 99.99%
```

```csharp
// Step 3: Application Insights integration
public static class CosmosDbTelemetry
{
    public static void ConfigureWithAppInsights(
        CosmosClientOptions options, 
        TelemetryClient telemetry)
    {
        // Track all operations as dependencies
        options.CosmosClientTelemetryOptions = new CosmosClientTelemetryOptions
        {
            DisableDistributedTracing = false  // Enable distributed tracing
        };
        
        // Custom handler for detailed telemetry
        options.CustomHandlers.Add(new AppInsightsHandler(telemetry));
    }
}

public class AppInsightsHandler : RequestHandler
{
    private readonly TelemetryClient _telemetry;
    
    public override async Task<ResponseMessage> SendAsync(
        RequestMessage request, 
        CancellationToken cancellationToken)
    {
        using var operation = _telemetry.StartOperation<DependencyTelemetry>(
            "CosmosDB", 
            request.RequestUri.ToString());
        
        operation.Telemetry.Type = "Azure DocumentDB";
        operation.Telemetry.Target = request.RequestUri.Host;
        
        var response = await base.SendAsync(request, cancellationToken);
        
        operation.Telemetry.Success = response.IsSuccessStatusCode;
        operation.Telemetry.ResultCode = ((int)response.StatusCode).ToString();
        operation.Telemetry.Properties["RU"] = response.Headers.RequestCharge.ToString();
        
        return response;
    }
}
```

```kusto
// Useful Log Analytics queries

// RU consumption by operation
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.DOCUMENTDB"
| summarize TotalRU = sum(requestCharge_s), 
            AvgRU = avg(requestCharge_s),
            Count = count()
    by OperationName
| order by TotalRU desc

// Slow queries
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.DOCUMENTDB"
| where duration_s > 100  // > 100ms
| project TimeGenerated, OperationName, duration_s, 
          requestCharge_s, partitionKey_s, querytext_s

// Storage growth trend
AzureMetrics
| where ResourceProvider == "MICROSOFT.DOCUMENTDB"
| where MetricName == "DataUsage"
| summarize StorageGB = max(Total) / 1073741824 by bin(TimeGenerated, 1d)
| order by TimeGenerated
```

Essential alerts to configure:
1. Throttling (429s) > 0
2. Normalized RU > 90% for 5 min
3. Availability < 99.99%
4. P99 latency > threshold
5. Storage approaching limits

Reference: [Monitor Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/monitor)
