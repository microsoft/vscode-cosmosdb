---
name: cosmosdb-best-practices
description: |
  Azure Cosmos DB performance optimization and best practices guidelines for NoSQL,
  partitioning, queries, and SDK usage. Use when writing, reviewing, or refactoring
  code that interacts with Azure Cosmos DB, designing data models, optimizing queries,
  or implementing high-performance database operations.
license: MIT
metadata:
  author: Azure Cosmos DB Team
  version: "1.0.0"
---

# Azure Cosmos DB Best Practices

Comprehensive performance optimization guide for Azure Cosmos DB applications, containing 45+ rules across 8 categories, prioritized by impact to guide automated refactoring and code generation.

## When to Apply

Reference these guidelines when:
- Designing data models for Cosmos DB
- Choosing partition keys
- Writing or optimizing queries
- Implementing SDK patterns
- Reviewing code for performance issues
- Configuring throughput and scaling
- Building globally distributed applications

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Data Modeling | CRITICAL | `model-` |
| 2 | Partition Key Design | CRITICAL | `partition-` |
| 3 | Query Optimization | HIGH | `query-` |
| 4 | SDK Best Practices | HIGH | `sdk-` |
| 5 | Indexing Strategies | MEDIUM-HIGH | `index-` |
| 6 | Throughput & Scaling | MEDIUM | `throughput-` |
| 7 | Global Distribution | MEDIUM | `global-` |
| 8 | Monitoring & Diagnostics | LOW-MEDIUM | `monitoring-` |

## Quick Reference

### 1. Data Modeling (CRITICAL)

- **model-embed-related** - Embed related data retrieved together
- **model-reference-large** - Reference data when items get too large
- **model-avoid-2mb-limit** - Keep items well under 2MB limit
- **model-denormalize-reads** - Denormalize for read-heavy workloads
- **model-schema-versioning** - Version your document schemas
- **model-type-discriminator** - Use type discriminators for polymorphic data

### 2. Partition Key Design (CRITICAL)

- **partition-high-cardinality** - Choose high-cardinality partition keys
- **partition-avoid-hotspots** - Distribute writes evenly
- **partition-hierarchical** - Use hierarchical partition keys for flexibility
- **partition-query-patterns** - Align partition key with query patterns
- **partition-synthetic-keys** - Create synthetic keys when needed
- **partition-20gb-limit** - Plan for 20GB logical partition limit

### 3. Query Optimization (HIGH)

- **query-avoid-cross-partition** - Minimize cross-partition queries
- **query-use-projections** - Project only needed fields
- **query-pagination** - Use continuation tokens for pagination
- **query-avoid-scans** - Avoid full container scans
- **query-parameterize** - Use parameterized queries
- **query-order-filters** - Order filters by selectivity

### 4. SDK Best Practices (HIGH)

- **sdk-singleton-client** - Reuse CosmosClient as singleton
- **sdk-async-api** - Use async APIs for throughput
- **sdk-retry-429** - Handle 429s with retry-after
- **sdk-connection-mode** - Use Direct mode for production
- **sdk-preferred-regions** - Configure preferred regions
- **sdk-diagnostics** - Log diagnostics for troubleshooting

### 5. Indexing Strategies (MEDIUM-HIGH)

- **index-exclude-unused** - Exclude paths never queried
- **index-composite** - Use composite indexes for ORDER BY
- **index-spatial** - Add spatial indexes for geo queries
- **index-range-vs-hash** - Choose appropriate index types
- **index-lazy-consistent** - Understand indexing modes

### 6. Throughput & Scaling (MEDIUM)

- **throughput-autoscale** - Use autoscale for variable workloads
- **throughput-right-size** - Right-size provisioned throughput
- **throughput-serverless** - Consider serverless for dev/test
- **throughput-burst** - Understand burst capacity
- **throughput-container-vs-database** - Choose allocation level wisely

### 7. Global Distribution (MEDIUM)

- **global-multi-region** - Configure multi-region writes
- **global-consistency** - Choose appropriate consistency level
- **global-conflict-resolution** - Implement conflict resolution
- **global-failover** - Configure automatic failover
- **global-read-regions** - Add read regions near users

### 8. Monitoring & Diagnostics (LOW-MEDIUM)

- **monitoring-ru-consumption** - Track RU consumption
- **monitoring-latency** - Monitor P99 latency
- **monitoring-throttling** - Alert on throttling
- **monitoring-azure-monitor** - Integrate Azure Monitor
- **monitoring-diagnostic-logs** - Enable diagnostic logging

## Detailed Guidelines

### Data Modeling Best Practices

- Model your data to **minimize cross-partition queries** and joins.
- Prefer **embedding related data** within a single item if access patterns always retrieve them together.
  - Avoid creating very large items — **Azure Cosmos DB enforces a 2 MB limit per item**.
  - If embedding makes items too large or frequently updated fields differ, consider **referencing (normalization)** instead.
- Use **Hierarchical Partition Keys (HPK)** to:
  - **Overcome the 20 GB limit** of a single logical partition.
  - **Improve query flexibility** by enabling targeted multi-partition queries (limited to a few partitions).
- Ensure even data distribution to prevent hot partitions.

### Partition Key Choice

- Choose a partition key that:
  - Ensures **high cardinality** (many unique values).
  - Supports your **most common query patterns**.
  - Avoids a single partition becoming a hotspot.
- Examples of good keys: `userId`, `tenantId`, `deviceId`.
- Avoid low-cardinality keys like `status` or `country`.

### SDK Best Practices

- Always use the **latest Azure Cosmos DB SDK** for your language.
- Enable **connection retries** and **preferred regions** for availability.
- Use **async APIs** where available for better throughput.
- Handle exceptions gracefully, especially `429 (Request Rate Too Large)` with **retry-after logic**.
- Avoid repeatedly creating new `CosmosClient` instances; instead, reuse a singleton.
- **Log diagnostic information** from the SDK to monitor performance and reliability:
  - Capture and review the **diagnostic string** when:
    - **Latency exceeds expected thresholds**, or
    - **An unexpected status code** is returned.
  - Use this data to identify bottlenecks, optimize queries, or tune RUs.

### Developer Tooling

#### Using the Azure Cosmos DB VS Code Extension

- Install the [`ms-azure-tools.azure-cosmos-db`](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-cosmosdb) extension.
- Use the extension to:
  - Connect to Azure Cosmos DB accounts.
  - View, query, and manage databases, containers, and items.
  - Inspect data locally and in the cloud without writing custom scripts.
- Prefer the extension for **day-to-day data inspection** over manual API calls.

#### Using the Cosmos DB Emulator

- Use the [Azure Cosmos DB Emulator](https://learn.microsoft.com/azure/cosmos-db/emulator) for local development and testing.
- Benefits:
  - No cloud costs for development and testing.
  - Full fidelity with the Cosmos DB service (SQL API).
- Run the emulator in **Docker** or on your local machine.
- Update connection strings in your app for emulator use (`https://localhost:8081/` with the provided key).

### Additional Guidelines

- Use **diagnostics logging** and **Azure Monitor** for observability.
- Test and adjust **Request Units (RUs)** based on workload.
- Use **server-side stored procedures, triggers, and UDFs** only when necessary.
- Regularly review [Cosmos DB Well-Architected Framework guidance](https://learn.microsoft.com/azure/well-architected/service-guides/cosmos-db).
