---
name: cosmosdb-best-practices
description: |
  Azure Cosmos DB performance optimization and best practices guidelines for NoSQL,
  partitioning, queries, and SDK usage. Use when writing, reviewing, or refactoring
  code that interacts with Azure Cosmos DB, designing data models, optimizing queries,
  or implementing high-performance database operations.

license: MIT
metadata:
  author: cosmosdb-agent-kit
  version: "1.0.0"
---

# Azure Cosmos DB Best Practices

Comprehensive performance optimization guide for Azure Cosmos DB applications, containing 75+ rules across 11 categories, prioritized by impact to guide automated refactoring and code generation.

## When to Apply

Reference these guidelines when:
- Designing data models for Cosmos DB
- Choosing partition keys
- Writing or optimizing queries
- Implementing SDK patterns
- Using the Cosmos DB Emulator for local development
- Inspecting or managing Cosmos DB data with developer tooling
- Implementing vector search or RAG features on Cosmos DB
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
| 9 | Design Patterns | HIGH | `pattern-` |
| 10 | Developer Tooling | MEDIUM | `tooling-` |
| 11 | Vector Search | HIGH | `vector-` |

## Quick Reference

### 1. Data Modeling (CRITICAL)

- [model-embed-related](rules/model-embed-related.md) - Embed related data retrieved together
- [model-reference-large](rules/model-reference-large.md) - Reference data when items get too large
- [model-avoid-2mb-limit](rules/model-avoid-2mb-limit.md) - Keep items well under 2MB limit
- [model-id-constraints](rules/model-id-constraints.md) - Follow ID value length and character constraints
- [model-nesting-depth](rules/model-nesting-depth.md) - Stay within 128-level nesting depth limit
- [model-numeric-precision](rules/model-numeric-precision.md) - Understand IEEE 754 numeric precision limits
- [model-denormalize-reads](rules/model-denormalize-reads.md) - Denormalize for read-heavy workloads
- [model-schema-versioning](rules/model-schema-versioning.md) - Version your document schemas
- [model-type-discriminator](rules/model-type-discriminator.md) - Use type discriminators for polymorphic data
- [model-json-serialization](rules/model-json-serialization.md) - Handle JSON serialization correctly for Cosmos DB documents
- [model-relationship-references](rules/model-relationship-references.md) - Use ID references with transient hydration for document relationships

### 2. Partition Key Design (CRITICAL)

- [partition-high-cardinality](rules/partition-high-cardinality.md) - Choose high-cardinality partition keys
- [partition-avoid-hotspots](rules/partition-avoid-hotspots.md) - Distribute writes evenly
- [partition-hierarchical](rules/partition-hierarchical.md) - Use hierarchical partition keys for flexibility
- [partition-query-patterns](rules/partition-query-patterns.md) - Align partition key with query patterns
- [partition-synthetic-keys](rules/partition-synthetic-keys.md) - Create synthetic keys when needed
- [partition-key-length](rules/partition-key-length.md) - Respect partition key value length limits
- [partition-20gb-limit](rules/partition-20gb-limit.md) - Plan for 20GB logical partition limit

### 3. Query Optimization (HIGH)

- [query-avoid-cross-partition](rules/query-avoid-cross-partition.md) - Minimize cross-partition queries
- [query-use-projections](rules/query-use-projections.md) - Project only needed fields
- [query-pagination](rules/query-pagination.md) - Use continuation tokens for pagination
- [query-avoid-scans](rules/query-avoid-scans.md) - Avoid full container scans
- [query-parameterize](rules/query-parameterize.md) - Use parameterized queries
- [query-order-filters](rules/query-order-filters.md) - Order filters by selectivity
- [query-top-literal](rules/query-top-literal.md) - Use literal integers for TOP, never parameters

### 4. SDK Best Practices (HIGH)

- [sdk-singleton-client](rules/sdk-singleton-client.md) - Reuse CosmosClient as singleton
- [sdk-async-api](rules/sdk-async-api.md) - Use async APIs for throughput
- [sdk-retry-429](rules/sdk-retry-429.md) - Handle 429s with retry-after
- [sdk-connection-mode](rules/sdk-connection-mode.md) - Use Direct mode for production
- [sdk-preferred-regions](rules/sdk-preferred-regions.md) - Configure preferred regions
- [sdk-excluded-regions](rules/sdk-excluded-regions.md) - Exclude regions experiencing issues
- [sdk-availability-strategy](rules/sdk-availability-strategy.md) - Configure availability strategy for resilience
- [sdk-circuit-breaker](rules/sdk-circuit-breaker.md) - Use circuit breaker for fault tolerance
- [sdk-diagnostics](rules/sdk-diagnostics.md) - Log diagnostics for troubleshooting
- [sdk-serialization-enums](rules/sdk-serialization-enums.md) - Serialize enums as strings not integers
- [sdk-emulator-ssl](rules/sdk-emulator-ssl.md) - Configure SSL and connection mode for Cosmos DB Emulator
- [sdk-etag-concurrency](rules/sdk-etag-concurrency.md) - Use ETags for optimistic concurrency on read-modify-write operations
- [sdk-java-content-response](rules/sdk-java-content-response.md) - Enable content response on write operations (Java)
- [sdk-java-cosmos-config](rules/sdk-java-cosmos-config.md) - Configure Cosmos DB initialization correctly in Spring Boot
- [sdk-java-spring-boot-versions](rules/sdk-java-spring-boot-versions.md) - Match Java version to Spring Boot requirements
- [sdk-local-dev-config](rules/sdk-local-dev-config.md) - Configure local development to avoid cloud conflicts
- [sdk-newtonsoft-dependency](rules/sdk-newtonsoft-dependency.md) - Explicitly reference Newtonsoft.Json package
- [sdk-python-async-deps](rules/sdk-python-async-deps.md) - Include aiohttp when using Python async SDK
- [sdk-spring-data-annotations](rules/sdk-spring-data-annotations.md) - Annotate entities for Spring Data Cosmos
- [sdk-spring-data-repository](rules/sdk-spring-data-repository.md) - Use CosmosRepository correctly and handle Iterable return types

### 5. Indexing Strategies (MEDIUM-HIGH)

- [index-exclude-unused](rules/index-exclude-unused.md) - Exclude paths never queried
- [index-composite](rules/index-composite.md) - Use composite indexes for ORDER BY
- [index-composite-direction](rules/index-composite-direction.md) - Match composite index directions to ORDER BY
- [index-spatial](rules/index-spatial.md) - Add spatial indexes for geo queries
- [index-range-vs-hash](rules/index-range-vs-hash.md) - Choose appropriate index types
- [index-lazy-consistent](rules/index-lazy-consistent.md) - Understand indexing modes

### 6. Throughput & Scaling (MEDIUM)

- [throughput-autoscale](rules/throughput-autoscale.md) - Use autoscale for variable workloads
- [throughput-right-size](rules/throughput-right-size.md) - Right-size provisioned throughput
- [throughput-serverless](rules/throughput-serverless.md) - Consider serverless for dev/test
- [throughput-burst](rules/throughput-burst.md) - Understand burst capacity
- [throughput-container-vs-database](rules/throughput-container-vs-database.md) - Choose allocation level wisely

### 7. Global Distribution (MEDIUM)

- [global-multi-region](rules/global-multi-region.md) - Configure multi-region writes
- [global-consistency](rules/global-consistency.md) - Choose appropriate consistency level
- [global-conflict-resolution](rules/global-conflict-resolution.md) - Implement conflict resolution
- [global-failover](rules/global-failover.md) - Configure automatic failover
- [global-read-regions](rules/global-read-regions.md) - Add read regions near users
- [global-zone-redundancy](rules/global-zone-redundancy.md) - Enable zone redundancy for HA

### 8. Monitoring & Diagnostics (LOW-MEDIUM)

- [monitoring-ru-consumption](rules/monitoring-ru-consumption.md) - Track RU consumption
- [monitoring-latency](rules/monitoring-latency.md) - Monitor P99 latency
- [monitoring-throttling](rules/monitoring-throttling.md) - Alert on throttling
- [monitoring-azure-monitor](rules/monitoring-azure-monitor.md) - Integrate Azure Monitor
- [monitoring-diagnostic-logs](rules/monitoring-diagnostic-logs.md) - Enable diagnostic logging

### 9. Design Patterns (HIGH)

- [pattern-change-feed-materialized-views](rules/pattern-change-feed-materialized-views.md) - Use Change Feed for cross-partition query optimization
- [pattern-efficient-ranking](rules/pattern-efficient-ranking.md) - Use count-based or cached approaches for efficient ranking
- [pattern-service-layer-relationships](rules/pattern-service-layer-relationships.md) - Use a service layer to hydrate document references

### 10. Developer Tooling (MEDIUM)

- [tooling-vscode-extension](rules/tooling-vscode-extension.md) - Use the VS Code extension for routine inspection and management
- [tooling-emulator-setup](rules/tooling-emulator-setup.md) - Use the Emulator for local development and testing

### 11. Vector Search (HIGH)

- [vector-enable-feature](rules/vector-enable-feature.md) - Enable vector search on the account before using vector features
- [vector-embedding-policy](rules/vector-embedding-policy.md) - Define vector embedding policy for vector properties
- [vector-index-type](rules/vector-index-type.md) - Configure vector indexes in the indexing policy
- [vector-normalize-embeddings](rules/vector-normalize-embeddings.md) - Normalize embeddings for cosine similarity
- [vector-distance-query](rules/vector-distance-query.md) - Use VectorDistance for similarity search
- [vector-repository-pattern](rules/vector-repository-pattern.md) - Implement a repository pattern for vector search

## How to Use

Use the linked rule files above for detailed explanations and code examples. The links give the agent direct paths to the relevant guidance instead of relying on folder scanning or inferred filenames.

Each rule file contains:
- Brief explanation of why it matters
- Incorrect code example with explanation
- Correct code example with explanation
- Additional context and references

## Full Compiled Document

For the complete guide with all rules expanded: [AGENTS.md](AGENTS.md)
