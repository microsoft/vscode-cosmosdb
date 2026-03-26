---
title: Monitor P99 Latency
impact: MEDIUM
impactDescription: identifies performance issues
tags: monitoring, latency, p99, performance
---

## Monitor P99 Latency

Track P99 (99th percentile) latency to identify performance outliers. Average latency hides tail latency issues that affect user experience.

**Incorrect (only tracking average latency):**

```csharp
// Average latency looks good: 5ms
// But P99 could be 500ms - 1% of users have terrible experience!

public async Task<Order> GetOrder(string orderId, string customerId)
{
    var sw = Stopwatch.StartNew();
    var result = await _container.ReadItemAsync<Order>(orderId, pk);
    sw.Stop();
    
    // Only tracking average is misleading
    _metrics.TrackAverage("CosmosDB.Latency", sw.ElapsedMilliseconds);
    // Average: 5ms (hides that some requests take 500ms)
    
    return result.Resource;
}
```

**Correct (tracking latency distribution):**

```csharp
public async Task<Order> GetOrder(string orderId, string customerId)
{
    var sw = Stopwatch.StartNew();
    var response = await _container.ReadItemAsync<Order>(orderId, new PartitionKey(customerId));
    sw.Stop();
    
    var clientLatency = sw.ElapsedMilliseconds;
    var serverLatency = response.Diagnostics.GetClientElapsedTime().TotalMilliseconds;
    
    // Track as histogram (enables percentile calculations)
    _metrics.TrackHistogram("CosmosDB.Latency.Client", clientLatency);
    _metrics.TrackHistogram("CosmosDB.Latency.Server", serverLatency);
    
    // Alert on slow requests
    if (clientLatency > 100)  // 100ms threshold
    {
        _logger.LogWarning(
            "Slow Cosmos DB read: {LatencyMs}ms, Diagnostics: {Diagnostics}",
            clientLatency,
            response.Diagnostics.ToString());
    }
    
    return response.Resource;
}
```

```csharp
// Track percentiles with Application Insights
public class LatencyTracker
{
    private readonly TelemetryClient _telemetry;
    private readonly ConcurrentBag<double> _recentLatencies = new();
    private readonly Timer _reportTimer;
    
    public LatencyTracker(TelemetryClient telemetry)
    {
        _telemetry = telemetry;
        _reportTimer = new Timer(ReportPercentiles, null, 
            TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(1));
    }
    
    public void RecordLatency(double latencyMs)
    {
        _recentLatencies.Add(latencyMs);
    }
    
    private void ReportPercentiles(object state)
    {
        var latencies = _recentLatencies.ToArray();
        _recentLatencies.Clear();
        
        if (latencies.Length == 0) return;
        
        Array.Sort(latencies);
        
        var p50 = GetPercentile(latencies, 50);
        var p90 = GetPercentile(latencies, 90);
        var p99 = GetPercentile(latencies, 99);
        
        _telemetry.TrackMetric("CosmosDB.Latency.P50", p50);
        _telemetry.TrackMetric("CosmosDB.Latency.P90", p90);
        _telemetry.TrackMetric("CosmosDB.Latency.P99", p99);
        
        // Alert if P99 exceeds threshold
        if (p99 > 100)
        {
            _telemetry.TrackEvent("HighP99Latency", 
                new Dictionary<string, string> { { "P99", p99.ToString() } });
        }
    }
    
    private static double GetPercentile(double[] sorted, int percentile)
    {
        var index = (int)Math.Ceiling(percentile / 100.0 * sorted.Length) - 1;
        return sorted[Math.Max(0, index)];
    }
}
```

```csharp
// Azure Monitor / Log Analytics query for P99
// Query to get latency percentiles
/*
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.DOCUMENTDB"
| where TimeGenerated > ago(1h)
| summarize 
    P50 = percentile(duration_s, 50),
    P90 = percentile(duration_s, 90),
    P99 = percentile(duration_s, 99),
    Max = max(duration_s)
    by bin(TimeGenerated, 5m), OperationName
| order by TimeGenerated desc
*/
```

What P99 latency reveals:
- Network issues (high client vs server latency gap)
- Hot partitions (certain keys slow)
- Query efficiency problems
- Cross-partition query overhead
- Regional routing issues

Target latencies:
- Point reads: P99 < 10ms (same region)
- Queries: P99 < 50ms (depends on complexity)
- Cross-region: Add ~RTT to target

Reference: [Monitor latency](https://learn.microsoft.com/azure/cosmos-db/monitor-server-side-latency)
