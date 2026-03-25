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
  version: '1.0.0'
---

# Azure Cosmos DB Best Practices

Comprehensive performance optimization guide for Azure Cosmos DB applications, containing 70+ rules across 10 categories, prioritized by impact to guide automated refactoring and code generation.

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

| Priority | Category                 | Impact      | Prefix        |
| -------- | ------------------------ | ----------- | ------------- |
| 1        | Data Modeling            | CRITICAL    | `model-`      |
| 2        | Partition Key Design     | CRITICAL    | `partition-`  |
| 3        | Query Optimization       | HIGH        | `query-`      |
| 4        | SDK Best Practices       | HIGH        | `sdk-`        |
| 5        | Indexing Strategies      | MEDIUM-HIGH | `index-`      |
| 6        | Throughput & Scaling     | MEDIUM      | `throughput-` |
| 7        | Global Distribution      | MEDIUM      | `global-`     |
| 8        | Monitoring & Diagnostics | LOW-MEDIUM  | `monitoring-` |
| 9        | Design Patterns          | HIGH        | `pattern-`    |
| 10       | Vector Search            | HIGH        | `vector-`     |

## Quick Reference

### 1. Data Modeling (CRITICAL)

- [`model-embed-related`](references/model-embed-related.md) - Embed related data retrieved together
- [`model-reference-large`](references/model-reference-large.md) - Reference Data When Items Grow Large
- [`model-avoid-2mb-limit`](references/model-avoid-2mb-limit.md) - Keep items well under 2MB limit
- [`model-id-constraints`](references/model-id-constraints.md) - Follow ID value length and character constraints
- [`model-nesting-depth`](references/model-nesting-depth.md) - Stay within 128-level nesting depth limit
- [`model-numeric-precision`](references/model-numeric-precision.md) - Understand IEEE 754 numeric precision limits
- [`model-denormalize-reads`](references/model-denormalize-reads.md) - Denormalize for read-heavy workloads
- [`model-schema-versioning`](references/model-schema-versioning.md) - Version your document schemas
- [`model-type-discriminator`](references/model-type-discriminator.md) - Use type discriminators for polymorphic data
- [`model-json-serialization`](references/model-json-serialization.md) - Handle JSON serialization correctly for Cosmos DB documents
- [`model-relationship-references`](references/model-relationship-references.md) - Use ID references with transient hydration for document relationships

### 2. Partition Key Design (CRITICAL)

- [`partition-high-cardinality`](references/partition-high-cardinality.md) - Choose high-cardinality partition keys
- [`partition-avoid-hotspots`](references/partition-avoid-hotspots.md) - Distribute Writes to Avoid Hot Partitions
- [`partition-hierarchical`](references/partition-hierarchical.md) - Use hierarchical partition keys for flexibility
- [`partition-query-patterns`](references/partition-query-patterns.md) - Align partition key with query patterns
- [`partition-synthetic-keys`](references/partition-synthetic-keys.md) - Create Synthetic Partition Keys When Needed
- [`partition-key-length`](references/partition-key-length.md) - Respect partition key value length limits
- [`partition-20gb-limit`](references/partition-20gb-limit.md) - Plan for 20GB logical partition limit

### 3. Query Optimization (HIGH)

- [`query-avoid-cross-partition`](references/query-avoid-cross-partition.md) - Minimize cross-partition queries
- [`query-use-projections`](references/query-use-projections.md) - Project only needed fields
- [`query-pagination`](references/query-pagination.md) - Use continuation tokens for pagination
- [`query-avoid-scans`](references/query-avoid-scans.md) - Avoid full container scans
- [`query-parameterize`](references/query-parameterize.md) - Use parameterized queries
- [`query-order-filters`](references/query-order-filters.md) - Order filters by selectivity
- [`query-top-literal`](references/query-top-literal.md) - Use literal integers for TOP, never parameters

### 4. SDK Best Practices (HIGH)

- [`sdk-singleton-client`](references/sdk-singleton-client.md) - Reuse CosmosClient as singleton
- [`sdk-async-api`](references/sdk-async-api.md) - Use Async APIs for Better Throughput
- [`sdk-retry-429`](references/sdk-retry-429.md) - Handle 429 Errors with Retry-After
- [`sdk-connection-mode`](references/sdk-connection-mode.md) - Use Direct Connection Mode for Production
- [`sdk-preferred-regions`](references/sdk-preferred-regions.md) - Configure Preferred Regions for Availability
- [`sdk-excluded-regions`](references/sdk-excluded-regions.md) - Configure Excluded Regions for Dynamic Failover
- [`sdk-availability-strategy`](references/sdk-availability-strategy.md) - Configure Threshold-Based Availability Strategy (Hedging)
- [`sdk-circuit-breaker`](references/sdk-circuit-breaker.md) - Configure Partition-Level Circuit Breaker
- [`sdk-diagnostics`](references/sdk-diagnostics.md) - Log diagnostics for troubleshooting
- [`sdk-serialization-enums`](references/sdk-serialization-enums.md) - Use consistent enum serialization between Cosmos SDK and application layer
- [`sdk-emulator-ssl`](references/sdk-emulator-ssl.md) - Configure SSL and connection mode for Cosmos DB Emulator
- [`sdk-java-content-response`](references/sdk-java-content-response.md) - Unwrap CosmosItemResponse and enable content response in Java SDK
- [`sdk-java-spring-boot-versions`](references/sdk-java-spring-boot-versions.md) - Spring Boot and Java version compatibility for Cosmos DB SDK
- [`sdk-local-dev-config`](references/sdk-local-dev-config.md) - Configure local development environment to avoid cloud connection conflicts
- [`sdk-spring-data-annotations`](references/sdk-spring-data-annotations.md) - Annotate entities for Spring Data Cosmos with @Container, @PartitionKey, and String IDs
- [`sdk-spring-data-repository`](references/sdk-spring-data-repository.md) - Use CosmosRepository correctly and handle Iterable return types
- [`sdk-etag-concurrency`](references/sdk-etag-concurrency.md) - Use ETags for optimistic concurrency on read-modify-write operations
- [`sdk-java-cosmos-config`](references/sdk-java-cosmos-config.md) - Use dependent @Bean methods for Cosmos DB initialization in Spring Boot
- [`sdk-newtonsoft-dependency`](references/sdk-newtonsoft-dependency.md) - Explicitly reference Newtonsoft.Json package
- [`sdk-python-async-deps`](references/sdk-python-async-deps.md) - Include aiohttp when using Python async SDK

### 5. Indexing Strategies (MEDIUM-HIGH)

- [`index-exclude-unused`](references/index-exclude-unused.md) - Exclude Unused Index Paths
- [`index-composite`](references/index-composite.md) - Use composite indexes for ORDER BY
- [`index-spatial`](references/index-spatial.md) - Add spatial indexes for geo queries
- [`index-range-vs-hash`](references/index-range-vs-hash.md) - Choose appropriate index types
- [`index-lazy-consistent`](references/index-lazy-consistent.md) - Understand indexing modes
- [`index-composite-direction`](references/index-composite-direction.md) - Composite index directions must match ORDER BY

### 6. Throughput & Scaling (MEDIUM)

- [`throughput-autoscale`](references/throughput-autoscale.md) - Use autoscale for variable workloads
- [`throughput-right-size`](references/throughput-right-size.md) - Right-size provisioned throughput
- [`throughput-serverless`](references/throughput-serverless.md) - Consider serverless for dev/test
- [`throughput-burst`](references/throughput-burst.md) - Understand burst capacity
- [`throughput-container-vs-database`](references/throughput-container-vs-database.md) - Choose Container vs Database Throughput

### 7. Global Distribution (MEDIUM)

- [`global-multi-region`](references/global-multi-region.md) - Configure multi-region writes
- [`global-consistency`](references/global-consistency.md) - Choose appropriate consistency level
- [`global-conflict-resolution`](references/global-conflict-resolution.md) - Implement conflict resolution
- [`global-failover`](references/global-failover.md) - Configure automatic failover
- [`global-read-regions`](references/global-read-regions.md) - Add read regions near users
- [`global-zone-redundancy`](references/global-zone-redundancy.md) - Configure Zone Redundancy for High Availability

### 8. Monitoring & Diagnostics (LOW-MEDIUM)

- [`monitoring-ru-consumption`](references/monitoring-ru-consumption.md) - Track RU consumption
- [`monitoring-latency`](references/monitoring-latency.md) - Monitor P99 latency
- [`monitoring-throttling`](references/monitoring-throttling.md) - Alert on Throttling (429s)
- [`monitoring-azure-monitor`](references/monitoring-azure-monitor.md) - Integrate Azure Monitor
- [`monitoring-diagnostic-logs`](references/monitoring-diagnostic-logs.md) - Enable diagnostic logging

### 9. Design Patterns (HIGH)

- [`pattern-change-feed-materialized-views`](references/pattern-change-feed-materialized-views.md) - Use Change Feed for cross-partition query optimization with materialized views
- [`pattern-efficient-ranking`](references/pattern-efficient-ranking.md) - Use count-based or cached rank approaches instead of full partition scans for ranking
- [`pattern-service-layer-relationships`](references/pattern-service-layer-relationships.md) - Use a service layer to hydrate document references before rendering

### 10. Vector Search (HIGH)

- [`vector-enable-feature`](references/vector-enable-feature.md) - Enable vector search feature on account
- [`vector-embedding-policy`](references/vector-embedding-policy.md) - Define vector embedding policy
- [`vector-index-type`](references/vector-index-type.md) - Configure vector indexes in indexing policy
- [`vector-distance-query`](references/vector-distance-query.md) - Use VectorDistance for similarity search
- [`vector-normalize-embeddings`](references/vector-normalize-embeddings.md) - Normalize embeddings for cosine similarity
- [`vector-repository-pattern`](references/vector-repository-pattern.md) - Implement repository pattern for vector search

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
