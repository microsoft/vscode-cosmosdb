---
title: Avoid Full Container Scans
impact: HIGH
impactDescription: prevents unbounded RU consumption
tags: query, scan, index, performance
---

## Avoid Full Container Scans

Ensure queries can use indexes to filter data. Queries that can't use indexes scan entire partitions or containers.

**Incorrect (queries that cause scans):**

```csharp
// Functions on properties prevent index usage
var query = "SELECT * FROM c WHERE LOWER(c.email) = 'john@example.com'";
// Full scan! Index stores 'John@example.com', not lowercased

// CONTAINS without index
var query2 = "SELECT * FROM c WHERE CONTAINS(c.description, 'azure')";
// No full-text index = full scan

// NOT operations
var query3 = "SELECT * FROM c WHERE NOT c.status = 'completed'";
// Often causes scan (depends on index configuration)

// Type checking
var query4 = "SELECT * FROM c WHERE IS_STRING(c.name)";
// Schema checking = full scan

// OR with different properties (in some cases)
var query5 = "SELECT * FROM c WHERE c.firstName = 'John' OR c.lastName = 'Smith'";
// May scan if indexes can't be combined efficiently
```

**Correct (index-friendly queries):**

```csharp
// Store normalized data to avoid functions
public class User
{
    public string Email { get; set; }
    public string EmailLower { get; set; }  // Pre-computed lowercase
}

var query = "SELECT * FROM c WHERE c.emailLower = 'john@example.com'";
// Uses index directly!

// Use range operators that leverage indexes
var query2 = @"
    SELECT * FROM c 
    WHERE c.createdAt >= @start 
    AND c.createdAt < @end";
// Range index on createdAt

// Prefer equality and range over NOT
var query3 = @"
    SELECT * FROM c 
    WHERE c.status IN ('pending', 'processing', 'shipped')";
// Instead of NOT = 'completed'

// Use StartsWith for prefix matching (uses index)
var query4 = "SELECT * FROM c WHERE STARTSWITH(c.name, 'John')";
// Uses range index on name

// Split OR into UNION if needed for large datasets
// Or ensure composite indexes cover both paths
```

```csharp
// Check if query uses index with query metrics
var options = new QueryRequestOptions
{
    PopulateIndexMetrics = true,
    PartitionKey = new PartitionKey(partitionKey)
};

var iterator = container.GetItemQueryIterator<Product>(query, requestOptions: options);
var response = await iterator.ReadNextAsync();

// Check index metrics in diagnostics
Console.WriteLine($"Index Hit: {response.Diagnostics}");
// Look for "IndexLookupTime" vs "ScanTime"
```

Reference: [Query optimization](https://learn.microsoft.com/azure/cosmos-db/nosql/query-metrics)
