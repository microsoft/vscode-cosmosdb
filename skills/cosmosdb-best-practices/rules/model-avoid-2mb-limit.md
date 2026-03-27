---
title: Keep Items Well Under 2MB Limit
impact: CRITICAL
impactDescription: prevents write failures
tags: model, item-size, limits, design
---

## Keep Items Well Under 2MB Limit

Azure Cosmos DB enforces a 2MB maximum item size. Design documents to stay well under this limit to avoid runtime failures.

**Incorrect (risk of hitting limit):**

```csharp
// Anti-pattern: storing large binary data in documents
public class Document
{
    public string Id { get; set; }
    public string Name { get; set; }
    
    // Large base64-encoded file content - DANGER!
    public string FileContent { get; set; }  // Could be megabytes
    
    // Or large arrays that grow
    public List<AuditEntry> AuditLog { get; set; }  // Unbounded
}

// This will fail when content exceeds 2MB
await container.CreateItemAsync(doc);
// Microsoft.Azure.Cosmos.CosmosException: Request Entity Too Large
```

**Correct (bounded document size):**

```csharp
// Store metadata in Cosmos DB, large content in Blob Storage
public class Document
{
    public string Id { get; set; }
    public string Name { get; set; }
    public long FileSizeBytes { get; set; }
    public string ContentType { get; set; }
    
    // Reference to blob storage instead of inline content
    public string BlobUri { get; set; }
    
    // Keep only recent/relevant audit entries
    public List<AuditEntry> RecentAuditEntries { get; set; }  // Max 10-20 items
}

// Large content goes to Blob Storage
await blobClient.UploadAsync(largeFileStream);
var doc = new Document
{
    Id = Guid.NewGuid().ToString(),
    Name = "large-file.pdf",
    BlobUri = blobClient.Uri.ToString()
};
await container.CreateItemAsync(doc);
```

Size monitoring:

```csharp
// Check item size before writing
var json = JsonSerializer.Serialize(item);
var sizeBytes = Encoding.UTF8.GetByteCount(json);
if (sizeBytes > 1_500_000) // 1.5MB warning threshold
{
    _logger.LogWarning("Item approaching size limit: {SizeKB}KB", sizeBytes / 1024);
}
```

Reference: [Azure Cosmos DB service quotas](https://learn.microsoft.com/azure/cosmos-db/concepts-limits)
