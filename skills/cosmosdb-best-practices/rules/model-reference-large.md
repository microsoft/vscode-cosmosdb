---
title: Reference Data When Items Grow Large
impact: CRITICAL
impactDescription: prevents hitting 2MB limit
tags: model, referencing, normalization, large-documents
---

## Reference Data When Items Grow Large

Use document references instead of embedding when embedded data would make items too large, or when embedded data changes independently.

**Incorrect (embedded array grows unbounded):**

```csharp
// Anti-pattern: blog post with all comments embedded
public class BlogPost
{
    public string Id { get; set; }
    public string Title { get; set; }
    public string Content { get; set; }
    
    // This array can grow forever - will eventually hit 2MB limit!
    public List<Comment> Comments { get; set; } // Could be thousands
}

// Eventually fails when document exceeds 2MB
await container.UpsertItemAsync(blogPost);
// RequestEntityTooLarge exception
```

**Correct (reference pattern for unbounded relationships):**

```csharp
// Blog post document (bounded size)
public class BlogPost
{
    public string Id { get; set; }
    public string PostId { get; set; }  // Partition key
    public string Type { get; set; } = "post";
    public string Title { get; set; }
    public string Content { get; set; }
    public int CommentCount { get; set; }  // Denormalized count
}

// Separate comment documents (same partition for efficient queries)
public class Comment
{
    public string Id { get; set; }
    public string PostId { get; set; }  // Partition key - same as post
    public string Type { get; set; } = "comment";
    public string AuthorId { get; set; }
    public string Text { get; set; }
    public DateTime CreatedAt { get; set; }
}

// Query comments within same partition - efficient!
var comments = container.GetItemQueryIterator<Comment>(
    new QueryDefinition("SELECT * FROM c WHERE c.postId = @postId AND c.type = 'comment' ORDER BY c.createdAt DESC")
        .WithParameter("@postId", postId),
    requestOptions: new QueryRequestOptions { PartitionKey = new PartitionKey(postId) }
);
```

Use references when:
- Embedded data is unbounded (arrays that grow)
- Embedded data changes frequently/independently
- You need to query embedded data separately

Reference: [Model document data](https://learn.microsoft.com/azure/cosmos-db/nosql/modeling-data#referencing-data)
