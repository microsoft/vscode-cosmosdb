---
title: Use Parameterized Queries
impact: MEDIUM
impactDescription: improves security and query plan caching
tags: query, parameters, security, performance
---

## Use Parameterized Queries

Always use parameterized queries instead of string concatenation. This prevents injection attacks and enables query plan caching.

**Incorrect (string concatenation):**

```csharp
// SQL injection vulnerability!
public async Task<User> GetUser(string userId)
{
    // NEVER DO THIS - vulnerable to injection
    var query = $"SELECT * FROM c WHERE c.userId = '{userId}'";
    
    // Attacker input: "' OR '1'='1"
    // Results in: SELECT * FROM c WHERE c.userId = '' OR '1'='1'
    // Returns ALL users!
    
    var iterator = container.GetItemQueryIterator<User>(query);
    return (await iterator.ReadNextAsync()).FirstOrDefault();
}

// Also prevents query plan caching
// Each unique query string = new compilation
var query1 = "SELECT * FROM c WHERE c.userId = 'user1'";
var query2 = "SELECT * FROM c WHERE c.userId = 'user2'";
// Two different query plans compiled!
```

**Correct (parameterized queries):**

```csharp
public async Task<User> GetUser(string userId)
{
    var query = new QueryDefinition("SELECT * FROM c WHERE c.userId = @userId")
        .WithParameter("@userId", userId);
    
    // Injection attempt becomes literal string comparison
    // Attacker input "' OR '1'='1" just searches for that literal value
    
    var iterator = container.GetItemQueryIterator<User>(query);
    return (await iterator.ReadNextAsync()).FirstOrDefault();
}

// Query plan is cached and reused
var query1 = new QueryDefinition("SELECT * FROM c WHERE c.userId = @userId")
    .WithParameter("@userId", "user1");
var query2 = new QueryDefinition("SELECT * FROM c WHERE c.userId = @userId")
    .WithParameter("@userId", "user2");
// Same query plan reused!
```

```csharp
// Multiple parameters
var query = new QueryDefinition(@"
    SELECT * FROM c 
    WHERE c.customerId = @customerId 
    AND c.status = @status
    AND c.orderDate >= @startDate")
    .WithParameter("@customerId", customerId)
    .WithParameter("@status", "active")
    .WithParameter("@startDate", startDate);

// Array parameter for IN clauses
var statuses = new[] { "pending", "processing", "shipped" };
var query2 = new QueryDefinition(
    "SELECT * FROM c WHERE ARRAY_CONTAINS(@statuses, c.status)")
    .WithParameter("@statuses", statuses);
```

```csharp
// LINQ (automatically parameterized)
var results = container.GetItemLinqQueryable<Order>()
    .Where(o => o.CustomerId == customerId && o.Status == status)
    .ToFeedIterator();
// SDK handles parameterization automatically
```

Benefits:
- Security: Prevents SQL injection
- Performance: Query plan caching and reuse
- Maintainability: Cleaner, type-safe code

**Rust (`azure_data_cosmos`):**

```rust
use azure_data_cosmos::Query;

// ✅ Parameterized query — safe and cacheable
let query = Query::from("SELECT * FROM c WHERE c.customerId = @customerId")
    .with_parameter("@customerId", customer_id)
    .unwrap();

// Multiple parameters
let query = Query::from(
    "SELECT * FROM c WHERE c.customerId = @cid AND c.status = @status ORDER BY c.createdAt DESC"
)
    .with_parameter("@cid", customer_id).unwrap()
    .with_parameter("@status", "active").unwrap();

// Aggregate query with parameters
let query = Query::from(
    "SELECT COUNT(1) AS totalOrders, SUM(c.total) AS totalSpent FROM c WHERE c.customerId = @cid"
)
    .with_parameter("@cid", customer_id).unwrap();
```

```rust
// ❌ Anti-pattern: String interpolation (no plan caching, injection risk)
let query = Query::from(format!(
    "SELECT * FROM c WHERE c.customerId = '{}'", customer_id
));
```

Reference: [Parameterized queries](https://learn.microsoft.com/azure/cosmos-db/nosql/query/parameterized-queries)
