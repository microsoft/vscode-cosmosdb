---
title: Follow ID Value Length and Character Constraints
impact: HIGH
impactDescription: prevents write failures and cross-SDK interoperability issues
tags: model, id, limits, interoperability, design
---

## Follow ID Value Length and Character Constraints

Azure Cosmos DB enforces a **1,023 byte** maximum for the `id` property and restricts certain characters. Using non-alphanumeric characters causes interoperability problems across SDKs, connectors, and tools.

**Incorrect (oversized or problematic IDs):**

```csharp
// Anti-pattern 1: ID derived from unbounded user input
public class Document
{
    // ID could exceed 1,023 bytes if title is very long
    public string Id => $"{Category}_{SubCategory}_{Title}_{Description}";
    public string Category { get; set; }
    public string SubCategory { get; set; }
    public string Title { get; set; }
    public string Description { get; set; }  // Unbounded!
}

// Anti-pattern 2: IDs containing forbidden or problematic characters
var doc = new Document
{
    Id = "files/reports\\2026/Q1",  // Contains '/' and '\' - FORBIDDEN
    Content = "..."
};
await container.CreateItemAsync(doc);
// Fails or causes routing issues

// Anti-pattern 3: Non-ASCII characters in IDs
var doc2 = new Document
{
    Id = "レポート_2026_データ",  // Non-ASCII - interoperability risk
    Content = "..."
};
// Works in some SDKs but may break in ADF, Spark, Kafka connectors
```

**Correct (safe, bounded IDs):**

```csharp
// Use GUIDs or short alphanumeric identifiers
public class Document
{
    public string Id { get; set; }
    public string Category { get; set; }
    public string Title { get; set; }
}

// Option 1: GUID-based IDs (always safe, always unique)
var doc = new Document
{
    Id = Guid.NewGuid().ToString(),  // "a1b2c3d4-e5f6-..."
    Category = "reports",
    Title = "Q1 Report"
};

// Option 2: Compact, deterministic IDs from business keys
var doc2 = new Document
{
    Id = $"report-{tenantId}-{DateTime.UtcNow:yyyyMMdd}-{sequenceNum}",
    Category = "reports",
    Title = "Q1 Report"
};

// Option 3: Base64-encode when you must derive from non-ASCII data
var rawId = "レポート_2026_データ";
var doc3 = new Document
{
    Id = Convert.ToBase64String(Encoding.UTF8.GetBytes(rawId))
            .Replace('/', '_').Replace('+', '-'),  // URL-safe Base64
    Category = "reports",
    Title = rawId  // Keep original value as a property
};
```

Key constraints:
- **Max length:** 1,023 bytes
- **Forbidden characters:** `/` and `\` are not allowed
- **Best practice:** Use only alphanumeric ASCII characters (`a-z`, `A-Z`, `0-9`, `-`, `_`)
- **Why:** Some SDK versions, Azure Data Factory, Spark connector, and Kafka connector have known issues with non-alphanumeric IDs
- Encode non-ASCII IDs with Base64 + custom encoding if needed for interoperability

Reference: [Azure Cosmos DB service quotas - Per-item limits](https://learn.microsoft.com/azure/cosmos-db/concepts-limits#per-item-limits)
