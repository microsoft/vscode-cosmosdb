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

- [`model-embed-related`](rules/model-embed-related.md) - Embed related data retrieved together
- [`model-reference-large`](rules/model-reference-large.md) - Reference Data When Items Grow Large
- [`model-avoid-2mb-limit`](rules/model-avoid-2mb-limit.md) - Keep items well under 2MB limit
- [`model-id-constraints`](rules/model-id-constraints.md) - Follow ID value length and character constraints
- [`model-nesting-depth`](rules/model-nesting-depth.md) - Stay within 128-level nesting depth limit
- [`model-numeric-precision`](rules/model-numeric-precision.md) - Understand IEEE 754 numeric precision limits
- [`model-denormalize-reads`](rules/model-denormalize-reads.md) - Denormalize for read-heavy workloads
- [`model-schema-versioning`](rules/model-schema-versioning.md) - Version your document schemas
- [`model-type-discriminator`](rules/model-type-discriminator.md) - Use type discriminators for polymorphic data
- [`model-json-serialization`](rules/model-json-serialization.md) - Handle JSON serialization correctly for Cosmos DB documents
- [`model-relationship-references`](rules/model-relationship-references.md) - Use ID references with transient hydration for document relationships

### 2. Partition Key Design (CRITICAL)

- [`partition-high-cardinality`](rules/partition-high-cardinality.md) - Choose high-cardinality partition keys
- [`partition-avoid-hotspots`](rules/partition-avoid-hotspots.md) - Distribute Writes to Avoid Hot Partitions
- [`partition-hierarchical`](rules/partition-hierarchical.md) - Use hierarchical partition keys for flexibility
- [`partition-query-patterns`](rules/partition-query-patterns.md) - Align partition key with query patterns
- [`partition-synthetic-keys`](rules/partition-synthetic-keys.md) - Create Synthetic Partition Keys When Needed
- [`partition-key-length`](rules/partition-key-length.md) - Respect partition key value length limits
- [`partition-20gb-limit`](rules/partition-20gb-limit.md) - Plan for 20GB logical partition limit

### 3. Query Optimization (HIGH)

- [`query-avoid-cross-partition`](rules/query-avoid-cross-partition.md) - Minimize cross-partition queries
- [`query-use-projections`](rules/query-use-projections.md) - Project only needed fields
- [`query-pagination`](rules/query-pagination.md) - Use continuation tokens for pagination
- [`query-avoid-scans`](rules/query-avoid-scans.md) - Avoid full container scans
- [`query-parameterize`](rules/query-parameterize.md) - Use parameterized queries
- [`query-order-filters`](rules/query-order-filters.md) - Order filters by selectivity
- [`query-top-literal`](rules/query-top-literal.md) - Use literal integers for TOP, never parameters

### 4. SDK Best Practices (HIGH)

- [`sdk-singleton-client`](rules/sdk-singleton-client.md) - Reuse CosmosClient as singleton
- [`sdk-async-api`](rules/sdk-async-api.md) - Use Async APIs for Better Throughput
- [`sdk-retry-429`](rules/sdk-retry-429.md) - Handle 429 Errors with Retry-After
- [`sdk-connection-mode`](rules/sdk-connection-mode.md) - Use Direct Connection Mode for Production
- [`sdk-preferred-regions`](rules/sdk-preferred-regions.md) - Configure Preferred Regions for Availability
- [`sdk-excluded-regions`](rules/sdk-excluded-regions.md) - Configure Excluded Regions for Dynamic Failover
- [`sdk-availability-strategy`](rules/sdk-availability-strategy.md) - Configure Threshold-Based Availability Strategy (Hedging)
- [`sdk-circuit-breaker`](rules/sdk-circuit-breaker.md) - Configure Partition-Level Circuit Breaker
- [`sdk-diagnostics`](rules/sdk-diagnostics.md) - Log diagnostics for troubleshooting
- [`sdk-serialization-enums`](rules/sdk-serialization-enums.md) - Use consistent enum serialization between Cosmos SDK and application layer
- [`sdk-emulator-ssl`](rules/sdk-emulator-ssl.md) - Configure SSL and connection mode for Cosmos DB Emulator
- [`sdk-java-content-response`](rules/sdk-java-content-response.md) - Unwrap CosmosItemResponse and enable content response in Java SDK
- [`sdk-java-spring-boot-versions`](rules/sdk-java-spring-boot-versions.md) - Spring Boot and Java version compatibility for Cosmos DB SDK
- [`sdk-local-dev-config`](rules/sdk-local-dev-config.md) - Configure local development environment to avoid cloud connection conflicts
- [`sdk-spring-data-annotations`](rules/sdk-spring-data-annotations.md) - Annotate entities for Spring Data Cosmos with @Container, @PartitionKey, and String IDs
- [`sdk-spring-data-repository`](rules/sdk-spring-data-repository.md) - Use CosmosRepository correctly and handle Iterable return types
- [`sdk-etag-concurrency`](rules/sdk-etag-concurrency.md) - Use ETags for optimistic concurrency on read-modify-write operations
- [`sdk-java-cosmos-config`](rules/sdk-java-cosmos-config.md) - Use dependent @Bean methods for Cosmos DB initialization in Spring Boot
- [`sdk-newtonsoft-dependency`](rules/sdk-newtonsoft-dependency.md) - Explicitly reference Newtonsoft.Json package
- [`sdk-python-async-deps`](rules/sdk-python-async-deps.md) - Include aiohttp when using Python async SDK

### 5. Indexing Strategies (MEDIUM-HIGH)

- [`index-exclude-unused`](rules/index-exclude-unused.md) - Exclude Unused Index Paths
- [`index-composite`](rules/index-composite.md) - Use composite indexes for ORDER BY
- [`index-spatial`](rules/index-spatial.md) - Add spatial indexes for geo queries
- [`index-range-vs-hash`](rules/index-range-vs-hash.md) - Choose appropriate index types
- [`index-lazy-consistent`](rules/index-lazy-consistent.md) - Understand indexing modes
- [`index-composite-direction`](rules/index-composite-direction.md) - Composite index directions must match ORDER BY

### 6. Throughput & Scaling (MEDIUM)

- [`throughput-autoscale`](rules/throughput-autoscale.md) - Use autoscale for variable workloads
- [`throughput-right-size`](rules/throughput-right-size.md) - Right-size provisioned throughput
- [`throughput-serverless`](rules/throughput-serverless.md) - Consider serverless for dev/test
- [`throughput-burst`](rules/throughput-burst.md) - Understand burst capacity
- [`throughput-container-vs-database`](rules/throughput-container-vs-database.md) - Choose Container vs Database Throughput

### 7. Global Distribution (MEDIUM)

- [`global-multi-region`](rules/global-multi-region.md) - Configure multi-region writes
- [`global-consistency`](rules/global-consistency.md) - Choose appropriate consistency level
- [`global-conflict-resolution`](rules/global-conflict-resolution.md) - Implement conflict resolution
- [`global-failover`](rules/global-failover.md) - Configure automatic failover
- [`global-read-regions`](rules/global-read-regions.md) - Add read regions near users
- [`global-zone-redundancy`](rules/global-zone-redundancy.md) - Configure Zone Redundancy for High Availability

### 8. Monitoring & Diagnostics (LOW-MEDIUM)

- [`monitoring-ru-consumption`](rules/monitoring-ru-consumption.md) - Track RU consumption
- [`monitoring-latency`](rules/monitoring-latency.md) - Monitor P99 latency
- [`monitoring-throttling`](rules/monitoring-throttling.md) - Alert on Throttling (429s)
- [`monitoring-azure-monitor`](rules/monitoring-azure-monitor.md) - Integrate Azure Monitor
- [`monitoring-diagnostic-logs`](rules/monitoring-diagnostic-logs.md) - Enable diagnostic logging

### 9. Design Patterns (HIGH)

- [`pattern-change-feed-materialized-views`](rules/pattern-change-feed-materialized-views.md) - Use Change Feed for cross-partition query optimization with materialized views
- [`pattern-efficient-ranking`](rules/pattern-efficient-ranking.md) - Use count-based or cached rank approaches instead of full partition scans for ranking
- [`pattern-service-layer-relationships`](rules/pattern-service-layer-relationships.md) - Use a service layer to hydrate document references before rendering

### 10. Vector Search (HIGH)

- [`vector-enable-feature`](rules/vector-enable-feature.md) - Enable vector search feature on account
- [`vector-embedding-policy`](rules/vector-embedding-policy.md) - Define vector embedding policy
- [`vector-index-type`](rules/vector-index-type.md) - Configure vector indexes in indexing policy
- [`vector-distance-query`](rules/vector-distance-query.md) - Use VectorDistance for similarity search
- [`vector-normalize-embeddings`](rules/vector-normalize-embeddings.md) - Normalize embeddings for cosine similarity
- [`vector-repository-pattern`](rules/vector-repository-pattern.md) - Implement repository pattern for vector search

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
