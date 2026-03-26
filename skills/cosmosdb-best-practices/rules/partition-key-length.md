---
title: Respect Partition Key Value Length Limits
impact: HIGH
impactDescription: prevents write failures from oversized keys
tags: partition, limits, key-length, design
---

## Respect Partition Key Value Length Limits

Azure Cosmos DB enforces a maximum partition key value length of **2,048 bytes** (or **101 bytes** if large partition keys are not enabled). Exceeding this limit causes write failures at runtime.

**Incorrect (risk of exceeding partition key length):**

```csharp
// Anti-pattern: concatenating many fields into a partition key
public class Document
{
    public string Id { get; set; }
    
    // Partition key built from long descriptions - DANGER!
    public string PartitionKey => $"{TenantName}_{DepartmentName}_{TeamName}_{ProjectDescription}";
    
    public string TenantName { get; set; }       // Could be very long
    public string DepartmentName { get; set; }
    public string TeamName { get; set; }
    public string ProjectDescription { get; set; } // Unbounded user input
}

// If PartitionKey exceeds 2,048 bytes:
// Microsoft.Azure.Cosmos.CosmosException: Partition key value is too large
```

**Correct (bounded partition key values):**

```csharp
// Use short, bounded identifiers for partition keys
public class Document
{
    public string Id { get; set; }
    
    // Short, deterministic IDs - always well under 2,048 bytes
    public string TenantId { get; set; }        // e.g., "t-abc123"
    public string DepartmentId { get; set; }    // e.g., "dept-42"
    
    // Partition key uses compact identifiers
    public string PartitionKey => $"{TenantId}_{DepartmentId}";
    
    // Keep long text as regular properties, not in the partition key
    public string TenantName { get; set; }
    public string DepartmentName { get; set; }
    public string ProjectDescription { get; set; }
}
```

```csharp
// If you must derive a key from long values, hash or truncate them
public class Document
{
    public string Id { get; set; }
    public string LongCategoryPath { get; set; }  // e.g., deep taxonomy
    
    // Hash long values to a fixed-length partition key
    public string PartitionKey
    {
        get
        {
            using var sha = System.Security.Cryptography.SHA256.Create();
            var hash = sha.ComputeHash(Encoding.UTF8.GetBytes(LongCategoryPath));
            return Convert.ToBase64String(hash)[..16]; // Fixed 16-char key
        }
    }
}
```

Key points:
- Default limit is **101 bytes** without large partition key feature enabled
- With large partition keys enabled, limit increases to **2,048 bytes**
- Enable large partition keys for new containers if you need longer values
- Prefer short GUIDs, IDs, or codes over human-readable strings for partition keys

Reference: [Azure Cosmos DB service quotas - Per-item limits](https://learn.microsoft.com/azure/cosmos-db/concepts-limits#per-item-limits)
