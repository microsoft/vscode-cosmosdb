---
name: cosmosdb-best-practices
description: |
  Azure Cosmos DB performance optimization and best practices guidelines for NoSQL,
  partitioning, queries, and SDK usage. Use when writing, reviewing, or refactoring
  code that interacts with Azure Cosmos DB, designing data models, optimizing queries,
  or implementing high-performance database operations.
  USE FOR: Cosmos DB NoSQL, partition key design, RU optimization, point reads,
  cross-partition queries, SDK singleton, CosmosClient, container modeling,
  change feed, bulk operations, vector search, full-text search, hierarchical
  partition keys, global distribution, autoscale throughput, indexing policy.
  DO NOT USE FOR: PostgreSQL, MySQL, MongoDB (non-Azure), DynamoDB, Cassandra,
  Azure SQL, Cosmos DB for PostgreSQL (vCore), Cosmos DB for MongoDB vCore, Azure DocumentDB,
  general SQL databases, Redis, Elasticsearch.

license: MIT
metadata:
  author: cosmosdb-agent-kit
  version: "1.0.0"
---

# Azure Cosmos DB Best Practices

Comprehensive performance optimization guide for Azure Cosmos DB applications, containing 100+ rules across 12 categories, prioritized by impact to guide automated refactoring and code generation.

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
- [model-denormalize-reads](rules/model-denormalize-reads.md) - Denormalize for read-heavy workloads including pre-computed aggregates
- [model-schema-versioning](rules/model-schema-versioning.md) - Version your document schemas
- [model-type-discriminator](rules/model-type-discriminator.md) - Use type discriminators for polymorphic data
- [model-json-serialization](rules/model-json-serialization.md) - Handle JSON serialization correctly for Cosmos DB documents
- [model-relationship-references](rules/model-relationship-references.md) - Use ID references with transient hydration for document relationships

### 2. Partition Key Design (CRITICAL)

- [partition-high-cardinality](rules/partition-high-cardinality.md) - Choose high-cardinality partition keys
- [partition-avoid-hotspots](rules/partition-avoid-hotspots.md) - Distribute writes evenly
- [partition-hierarchical](rules/partition-hierarchical.md) - Use hierarchical partition keys for flexibility; order levels broad→narrow
- [partition-query-patterns](rules/partition-query-patterns.md) - Align partition key with query patterns
- [partition-synthetic-keys](rules/partition-synthetic-keys.md) - Create synthetic keys when needed
- [partition-key-length](rules/partition-key-length.md) - Respect partition key value length limits
- [partition-immutable-key](rules/partition-immutable-key.md) - Choose immutable properties as partition keys
- [partition-20gb-limit](rules/partition-20gb-limit.md) - Plan for 20GB logical partition limit
- [partition-rekey-migration](rules/partition-rekey-migration.md) - Re-key a misaligned container with the Change partition key feature

### 3. Query Optimization (HIGH)

- [query-aggregate-single-pass](rules/query-aggregate-single-pass.md) - Compute min/max/avg with one scoped aggregate query
- [query-avoid-cross-partition](rules/query-avoid-cross-partition.md) - Minimize cross-partition queries
- [query-use-projections](rules/query-use-projections.md) - Project only needed fields; prefer dedicated result types for projections
- [query-pagination](rules/query-pagination.md) - Use continuation tokens for pagination
- [query-avoid-scans](rules/query-avoid-scans.md) - Avoid full container scans
- [query-parameterize](rules/query-parameterize.md) - Use parameterized queries
- [query-order-filters](rules/query-order-filters.md) - Order filters by selectivity
- [query-top-literal](rules/query-top-literal.md) - Use literal integers for TOP, never parameters
- [query-latest-by-timestamp](rules/query-latest-by-timestamp.md) - Query "latest" documents with explicit ORDER BY and TOP 1
- [query-olap-detection](rules/query-olap-detection.md) - Detect and redirect analytical queries away from transactional containers
- [query-point-reads](rules/query-point-reads.md) - Use point reads (ReadItem) instead of queries when id and partition key are known

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
- [sdk-ifnonematch-create](rules/sdk-conditional-create-etag.md) - Use `setIfNoneMatchETag("*")` on `createItem` to reject duplicates atomically (409 on conflict)
- [sdk-no-shared-request-options](rules/sdk-request-options-per-call.md) - Never reuse a `CosmosItemRequestOptions` instance across multiple `createItem` calls — SDK mutates it internally, causing wrong partition key on second call
- [sdk-patch-incr](rules/sdk-patch-counter-increment.md) - Use `CosmosPatchOperations.incr()` for atomic counter increments — no read RU, no ETag conflict cycle
- [sdk-bypage-empty-token](rules/sdk-continuation-token-null-guard.md) - Guard against empty-string continuation tokens before calling `byPage()` — pass `null` for first page, never `""`
- [sdk-etag-concurrency](rules/sdk-etag-concurrency.md) - Use ETags for optimistic concurrency on read-modify-write operations
- [sdk-java-content-response](rules/sdk-java-content-response.md) - Enable content response on write operations (Java)
- [sdk-java-cosmos-config](rules/sdk-java-cosmos-config.md) - Configure Cosmos DB initialization correctly in Spring Boot
- [sdk-java-spring-boot-versions](rules/sdk-java-spring-boot-versions.md) - Match Java version to Spring Boot requirements
- [sdk-local-dev-config](rules/sdk-local-dev-config.md) - Configure local development to avoid cloud conflicts
- [sdk-dotnet-cosmos-package-id](rules/sdk-dotnet-cosmos-package-id.md) - Use `Microsoft.Azure.Cosmos`, not the abandoned `Azure.Cosmos` v4-preview package
- [sdk-newtonsoft-dependency](rules/sdk-newtonsoft-dependency.md) - Explicitly reference Newtonsoft.Json package
- [sdk-python-async-deps](rules/sdk-python-async-deps.md) - Include aiohttp when using Python async SDK
- [sdk-spring-data-annotations](rules/sdk-spring-data-annotations.md) - Annotate entities for Spring Data Cosmos
- [sdk-spring-data-repository](rules/sdk-spring-data-repository.md) - Use CosmosRepository correctly and handle Iterable return types
- [sdk-langchain-cosmosdb-saver](rules/sdk-langchain-cosmosdb-saver.md) - Use CosmosDBSaver for LangGraph checkpointing with async container client
- [sdk-langchain-async-checkpointer](rules/sdk-langchain-async-checkpointer.md) - Initialize async Cosmos DB container in startup routine, not module level
- [sdk-langchain-mcp-persistent-session](rules/sdk-langchain-mcp-persistent-session.md) - Maintain persistent MCP client sessions for application lifetime
- [sdk-langchain-mcp-tool-content-format](rules/sdk-langchain-mcp-tool-content-format.md) - Handle both string and list formats in MCP ToolMessage content
- [sdk-langgraph-mcp-tool-filtering](rules/sdk-langgraph-mcp-tool-filtering.md) - Filter MCP tools by name prefix for per-agent assignment
- [sdk-dotnet-namespace-collision](rules/sdk-dotnet-namespace-collision.md) - Avoid `Microsoft.Azure.Cosmos` namespace collisions with domain models (User, Database, Container, etc.)
- [sdk-ingestion-rate-control](rules/sdk-ingestion-rate-control.md) - Rate-control high-volume ingestion (concurrency, retry-after, throughput control)

### 5. Indexing Strategies (MEDIUM-HIGH)

- [index-exclude-unused](rules/index-exclude-unused.md) - Exclude paths never queried
- [index-path-syntax](rules/index-path-syntax.md) - Use correct path notation (`/?`, `/[]`, `/*`)
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
- [throughput-idle-container-review](rules/throughput-idle-container-review.md) - Review idle containers for lifecycle action
- [throughput-ttl-stale-data](rules/throughput-ttl-stale-data.md) - Expire stale data with TTL before hitting storage limits
- [throughput-serverless-migration](rules/throughput-serverless-migration.md) - Migrate a low-traffic provisioned account to serverless

### 7. Global Distribution (MEDIUM)

- [global-multi-region](rules/global-multi-region.md) - Configure multi-region writes
- [global-consistency](rules/global-consistency.md) - Choose appropriate consistency level
- [global-conflict-resolution](rules/global-conflict-resolution.md) - Implement conflict resolution
- [global-failover](rules/global-failover.md) - Configure automatic failover
- [global-read-regions](rules/global-read-regions.md) - Add read regions near users
- [global-zone-redundancy](rules/global-zone-redundancy.md) - Enable zone redundancy for HA
- [global-multi-region-write-antipattern](rules/global-multi-region-write-antipattern.md) - Avoid multi-region writes without an active-active need

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
- [pattern-langgraph-multi-agent](rules/pattern-langgraph-multi-agent.md) - Use StateGraph with conditional edges for multi-agent routing
- [pattern-langgraph-interrupt-human](rules/pattern-langgraph-interrupt-human.md) - Use LangGraph interrupt for human-in-the-loop confirmation flows
- [pattern-langgraph-resume-checkpoint](rules/pattern-langgraph-resume-checkpoint.md) - Resume LangGraph from checkpoint after interrupt for multi-turn conversations
- [pattern-langgraph-agent-routing-cosmosdb](rules/pattern-langgraph-agent-routing-cosmosdb.md) - Persist active agent in Cosmos DB for deterministic routing via point reads
- [pattern-langgraph-fastapi-startup](rules/pattern-langgraph-fastapi-startup.md) - Initialize LangGraph agents in FastAPI startup with retry logic
- [pattern-langgraph-chat-history-separate](rules/pattern-langgraph-chat-history-separate.md) - Store chat history in a dedicated container, not the checkpointer
- [pattern-background-task-writes](rules/pattern-background-task-writes.md) - Use FastAPI background tasks for non-blocking chat history writes
- [pattern-langgraph-async-cosmos-routing](rules/pattern-langgraph-async-cosmos-routing.md) - Wrap Cosmos DB sync calls in asyncio.to_thread for LangGraph routing functions
- [pattern-langgraph-async-cosmos-writes](rules/pattern-langgraph-async-cosmos-writes.md) - Use asyncio.to_thread for active agent writes in async node functions
- [pattern-langgraph-agent-name-attribution](rules/pattern-langgraph-agent-name-attribution.md) - Tag AI messages with agent name for API response attribution

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

### 12. Full-Text Search (HIGH)

- [fts-enable-capability](rules/fts-enable-capability.md) - Enable `EnableNoSQLFullTextSearch` capability on the account — prerequisite for all FTS functions
- [fts-full-text-policy](rules/fts-define-policy.md) - Define `fullTextPolicy` on the container with correct language code (`en-US`, case-sensitive)
- [fts-index-policy](rules/fts-add-index.md) - Add `fullTextIndexes` entry in the indexing policy to build the inverted index
- [fts-contains-query](rules/fts-keyword-matching.md) - Use `FullTextContains` / `FullTextContainsAll` / `FullTextContainsAny` instead of `CONTAINS(LOWER(...))`
- [fts-score-ranking](rules/fts-relevance-ranking.md) - Use `ORDER BY RANK FullTextScore(path, term)` for BM25 relevance ranking
- [fts-hybrid-query](rules/fts-hybrid-queries.md) - Combine FTS predicates with range/equality filters; put most selective filter first

## How to Use

Use the linked rule files above for detailed explanations and code examples. The links give the agent direct paths to the relevant guidance instead of relying on folder scanning or inferred filenames.

Each rule file contains:
- Brief explanation of why it matters
- Incorrect code example with explanation
- Correct code example with explanation
- Additional context and references
