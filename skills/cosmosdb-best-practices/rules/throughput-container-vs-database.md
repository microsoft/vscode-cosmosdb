---
title: Choose Container vs Database Throughput
impact: MEDIUM
impactDescription: optimizes cost and isolation
tags: throughput, container, database, allocation
---

## Choose Container vs Database Throughput

Decide between container-level (dedicated) and database-level (shared) throughput based on workload isolation needs and cost optimization.

**Container-level throughput (dedicated):**

```csharp
// Each container has dedicated RU/s
var ordersContainer = await database.CreateContainerAsync(
    new ContainerProperties("orders", "/customerId"),
    throughput: 10000);  // Dedicated 10,000 RU/s

var productsContainer = await database.CreateContainerAsync(
    new ContainerProperties("products", "/categoryId"),
    throughput: 2000);  // Dedicated 2,000 RU/s

// Benefits:
// - Guaranteed throughput per container
// - No "noisy neighbor" effect
// - Predictable performance

// Use when:
// - Critical workloads needing guaranteed throughput
// - Containers with very different usage patterns
// - High-throughput containers (> 10,000 RU/s)
```

**Database-level throughput (shared):**

```csharp
// Database shares throughput across containers
var database = await cosmosClient.CreateDatabaseAsync(
    "my-database",
    throughput: 10000);  // 10,000 RU/s shared across all containers

var ordersContainer = await database.CreateContainerAsync(
    new ContainerProperties("orders", "/customerId"));
    // No throughput specified - uses database shared pool

var productsContainer = await database.CreateContainerAsync(
    new ContainerProperties("products", "/categoryId"));
    // Also uses shared pool

var logsContainer = await database.CreateContainerAsync(
    new ContainerProperties("logs", "/date"));
    // Also uses shared pool

// Benefits:
// - Cost efficient for many low-traffic containers
// - Throughput flows to wherever it's needed
// - Minimum 400 RU/s total (vs 400 per container)

// Use when:
// - Many containers with varying/low traffic
// - Containers accessed at different times
// - Cost optimization is priority
```

**Hybrid approach:**

```csharp
// Shared database for most containers
var database = await cosmosClient.CreateDatabaseAsync(
    "my-database",
    throughput: 5000);  // 5,000 RU/s shared

// Dedicated throughput for critical/high-volume container
var ordersContainer = await database.CreateContainerAsync(
    new ContainerProperties("orders", "/customerId"),
    throughput: 10000);  // Dedicated 10,000 RU/s - NOT shared!

// Other containers share database throughput
var productsContainer = await database.CreateContainerAsync(
    new ContainerProperties("products", "/categoryId"));  // Shared
var usersContainer = await database.CreateContainerAsync(
    new ContainerProperties("users", "/userId"));  // Shared
```

Decision matrix:
| Scenario | Recommendation |
|----------|---------------|
| Few containers, predictable load | Container-level |
| Many containers, variable load | Database-level |
| Mixed critical + low-traffic | Hybrid |
| Multi-tenant isolation | Container-level per tenant |
| Development/testing | Database-level (cost saving) |

Reference: [Throughput on containers vs databases](https://learn.microsoft.com/azure/cosmos-db/set-throughput)
