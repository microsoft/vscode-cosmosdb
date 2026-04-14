---
title: Use Async APIs for Better Throughput
impact: HIGH
impactDescription: improves concurrency 10-100x
tags: sdk, async, throughput, performance
---

## Use Async APIs for Better Throughput

Always use async/await patterns for Cosmos DB operations. Synchronous calls block threads and severely limit throughput under load.

**Incorrect (blocking synchronous calls):**

```csharp
// Anti-pattern: Blocking async code
public Order GetOrder(string orderId, string customerId)
{
    // .Result blocks the calling thread!
    var response = _container.ReadItemAsync<Order>(
        orderId, 
        new PartitionKey(customerId)).Result;
    
    return response.Resource;
}

// Or using .Wait()
public void UpdateOrder(Order order)
{
    _container.UpsertItemAsync(order, new PartitionKey(order.CustomerId)).Wait();
}

// Problems:
// - Thread pool exhaustion under load
// - Potential deadlocks in ASP.NET
// - Cannot scale to handle concurrent requests
// - 100 concurrent requests = 100 blocked threads
```

**Correct (fully async):**

```csharp
public async Task<Order> GetOrderAsync(string orderId, string customerId)
{
    var response = await _container.ReadItemAsync<Order>(
        orderId, 
        new PartitionKey(customerId));
    
    return response.Resource;
}

public async Task UpdateOrderAsync(Order order)
{
    await _container.UpsertItemAsync(order, new PartitionKey(order.CustomerId));
}

// Async all the way up the call stack
public async Task<IActionResult> GetOrder(string id, string customerId)
{
    var order = await _orderRepository.GetOrderAsync(id, customerId);
    return Ok(order);
}
```

```csharp
// Concurrent operations with Task.WhenAll
public async Task<OrderWithItems> GetOrderWithItemsAsync(string orderId, string customerId)
{
    // Start both operations concurrently
    var orderTask = _container.ReadItemAsync<Order>(
        orderId, new PartitionKey(customerId));
    
    var itemsTask = _container.GetItemQueryIterator<OrderItem>(
        new QueryDefinition("SELECT * FROM c WHERE c.orderId = @orderId")
            .WithParameter("@orderId", orderId),
        requestOptions: new QueryRequestOptions { PartitionKey = new PartitionKey(customerId) }
    ).ReadNextAsync();
    
    // Wait for both to complete
    await Task.WhenAll(orderTask, itemsTask);
    
    return new OrderWithItems
    {
        Order = orderTask.Result.Resource,
        Items = itemsTask.Result.ToList()
    };
    // Total time ≈ max(order time, items time) instead of sum
}
```

```csharp
// Bulk operations with async streaming
public async Task<int> ImportProductsAsync(IAsyncEnumerable<Product> products)
{
    var count = 0;
    var tasks = new List<Task>();
    
    await foreach (var product in products)
    {
        tasks.Add(_container.UpsertItemAsync(product, new PartitionKey(product.CategoryId)));
        count++;
        
        // Limit concurrent operations to avoid overwhelming the client
        if (tasks.Count >= 100)
        {
            await Task.WhenAll(tasks);
            tasks.Clear();
        }
    }
    
    await Task.WhenAll(tasks);  // Complete remaining
    return count;
}
```

Reference: [Async programming best practices](https://learn.microsoft.com/azure/cosmos-db/nosql/best-practice-dotnet#use-async-methods)
