---
title: Denormalize for Read-Heavy Workloads
impact: HIGH
impactDescription: reduces query RU by 2-10x
tags: model, denormalization, read-optimization, performance
---

## Denormalize for Read-Heavy Workloads

In read-heavy workloads, denormalize frequently-queried data to avoid expensive lookups. Accept write overhead for faster reads.

**Incorrect (normalized requires multiple queries):**

```csharp
// Displaying product list with category names
public class Product
{
    public string Id { get; set; }
    public string Name { get; set; }
    public string CategoryId { get; set; }  // Just the ID
    public decimal Price { get; set; }
}

// To display "Product Name - Category Name" requires JOIN-like pattern:
var products = await GetProductsAsync();
foreach (var product in products)
{
    // N+1 query problem!
    var category = await container.ReadItemAsync<Category>(
        product.CategoryId, new PartitionKey(product.CategoryId));
    product.CategoryName = category.Name;
}
// 1 + N queries = terrible performance
```

**Correct (denormalized for read efficiency):**

```csharp
public class Product
{
    public string Id { get; set; }
    public string Name { get; set; }
    public string CategoryId { get; set; }
    
    // Denormalized category info for display
    public string CategoryName { get; set; }
    public string CategorySlug { get; set; }
    
    public decimal Price { get; set; }
}

// Single query returns everything needed for display
var query = "SELECT c.id, c.name, c.categoryName, c.price FROM c WHERE c.type = 'product'";
var products = await container.GetItemQueryIterator<Product>(query).ReadNextAsync();
// No additional queries needed!

// When category changes, update products using Change Feed
public async Task HandleCategoryChange(Category category)
{
    var query = $"SELECT * FROM c WHERE c.categoryId = '{category.Id}'";
    await foreach (var product in container.GetItemQueryIterator<Product>(query))
    {
        product.CategoryName = category.Name;
        await container.UpsertItemAsync(product);
    }
}
```

Denormalize when:
- Read-to-write ratio is high (10:1 or more)
- Denormalized data changes infrequently
- Query patterns benefit from co-located data

*Additional strategies to consider for denormalization*:
**Short-Circuit Denormalization** :
   - Definition: Duplicate *only specific fields* (not the full related document) to avoid a cross-partition lookup
   - When to use:
     - The duplicated property is mostly immutable (e.g., product name) or the app can tolerate staleness
     - The property is small (a string, not an object)
     - The access pattern would otherwise require a cross-partition read
   - Example: Copy `customerName` into Order doc to avoid looking up the Customer doc

**Workload-Driven Cost Comparison Template for Denormalization Strategy** :
   ```
   Option 1 — Denormalized:
     Read cost:  [read_RPS] × [RU_per_read] = X RU/s
     Write cost: [write_RPS] × [RU_per_write] + [update_propagation_cost] = Y RU/s
     Total: X + Y RU/s

   Option 2 — Normalized:
     Read cost:  [read_RPS] × ([RU_per_read] + [RU_for_lookup]) = X' RU/s
     Write cost: [write_RPS] × [RU_per_write] = Y' RU/s
     Total: X' + Y' RU/s

   Decision: Choose option with lower total RU/s when workload profile details available
   ```

Reference: [Denormalization patterns](https://learn.microsoft.com/azure/cosmos-db/nosql/modeling-data#denormalization)
