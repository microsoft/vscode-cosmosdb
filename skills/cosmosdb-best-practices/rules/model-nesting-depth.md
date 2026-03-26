---
title: Stay Within 128-Level Nesting Depth Limit
impact: MEDIUM
impactDescription: prevents document rejection on deeply nested structures
tags: model, nesting, limits, design, json
---

## Stay Within 128-Level Nesting Depth Limit

Azure Cosmos DB allows a maximum of **128 levels** of nesting for embedded objects and arrays. While 128 is generous, recursive or auto-generated structures can exceed this limit unexpectedly.

**Incorrect (risk of exceeding nesting limit):**

```csharp
// Anti-pattern 1: Recursive tree stored as deeply nested JSON
public class TreeNode
{
    public string Id { get; set; }
    public string Name { get; set; }
    
    // Recursive children - each level adds nesting depth
    public List<TreeNode> Children { get; set; }
}

// A category hierarchy with 130+ levels will fail on write
var root = BuildDeepTree(depth: 150);  // Exceeds 128 levels!
await container.CreateItemAsync(root);
// Microsoft.Azure.Cosmos.CosmosException: Document nesting depth exceeds limit

// Anti-pattern 2: Deeply nested auto-generated JSON from ORMs
// Serializing complex object graphs without cycle detection
var entity = LoadEntityWithAllRelations();  // Lazy-loaded relations
var json = JsonSerializer.Serialize(entity);  // May create deep nesting
```

**Correct (bounded nesting depth):**

```csharp
// Solution 1: Flatten deep hierarchies using path-based approach
public class CategoryNode
{
    public string Id { get; set; }
    public string Name { get; set; }
    public string ParentId { get; set; }
    
    // Materialized path captures hierarchy without nesting
    public string Path { get; set; }  // e.g., "/root/electronics/phones/android"
    public int Depth { get; set; }
    
    // Only store immediate children IDs, not nested objects
    public List<string> ChildIds { get; set; }
}

// Each node is a flat document, hierarchy expressed via Path and ParentId
var node = new CategoryNode
{
    Id = "cat-android",
    Name = "Android",
    ParentId = "cat-phones",
    Path = "/root/electronics/phones/android",
    Depth = 3,
    ChildIds = new List<string> { "cat-samsung", "cat-pixel" }
};
```

```csharp
// Solution 2: Cap nesting depth when building recursive structures
public class TreeNode
{
    public string Id { get; set; }
    public string Name { get; set; }
    public List<TreeNode> Children { get; set; }
}

// Limit nesting at serialization time
public static TreeNode TruncateTree(TreeNode node, int maxDepth, int currentDepth = 0)
{
    if (currentDepth >= maxDepth || node.Children == null)
    {
        node.Children = null;  // Stop nesting here
        return node;
    }
    
    node.Children = node.Children
        .Select(c => TruncateTree(c, maxDepth, currentDepth + 1))
        .ToList();
    return node;
}

// Keep well under 128 - aim for practical limits like 10-20
var safeTree = TruncateTree(root, maxDepth: 20);
await container.CreateItemAsync(safeTree);
```

Key points:
- Maximum nesting depth is **128 levels** for embedded objects/arrays
- Recursive data structures (trees, graphs) are the most common cause of violations
- Prefer flat representations with references (parent IDs, materialized paths) for deep hierarchies
- If nesting is required, enforce a practical depth cap well under 128

Reference: [Azure Cosmos DB service quotas - Per-item limits](https://learn.microsoft.com/azure/cosmos-db/concepts-limits#per-item-limits)
