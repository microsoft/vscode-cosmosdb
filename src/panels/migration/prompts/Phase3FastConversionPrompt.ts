/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type BasePromptElementProps,
    PromptElement,
    type PromptPiece,
    type PromptSizing,
    TextChunk,
    UserMessage,
} from '@vscode/prompt-tsx';

declare const vscpp: (ctor: unknown, props: unknown, ...children: unknown[]) => PromptPiece;
declare const vscppf: { isFragment: boolean };

interface Phase3FastConversionPromptProps extends BasePromptElementProps {
    domainSummary: string;
    bestPractices: string;
    indexPathSyntaxRule: string;
    sourceType: string;
    outputRelativePath: string;
    schemaConversionInstructions: string;
}

/**
 * Fast single-pass schema conversion prompt.
 * Combines all 6 analysis concerns (container design, partition key selection,
 * embedding decisions, access pattern mapping, cross-partition analysis, and
 * indexing policy design) plus summary generation into one comprehensive prompt.
 *
 * Output: JSON with { cosmosModel, summary } — the complete CosmosModel and
 * a markdown summary document.
 */
export class Phase3FastConversionPrompt extends PromptElement<Phase3FastConversionPromptProps> {
    render(_state: void, _sizing: PromptSizing): PromptPiece {
        return vscpp(
            vscppf,
            null,
            vscpp(
                UserMessage,
                { priority: 200 },
                vscpp(
                    TextChunk,
                    null,
                    `You are an expert Azure Cosmos DB NoSQL architect. Your task is to perform a complete
schema conversion for a domain being migrated from a relational database (${this.props.sourceType})
to Azure Cosmos DB NoSQL. You must analyze the domain and produce a fully optimized data model
covering all aspects in a single pass.

## Required Preparation (BEFORE producing any output)

You have access to a \`loadSkillSupplementaryFile\` tool that can load detailed rules from the
Cosmos DB best practices skill. Before drafting the model, call this tool (you may batch
multiple calls in one round) to load any rules from the skill overview that are clearly
relevant to this domain's access patterns and entities. At minimum, load deeper guidance for:

- Partition key selection (e.g. \`rules/partition-high-cardinality.md\`,
  \`rules/partition-hierarchical.md\`) when the domain has multi-tenant or hierarchical data.
- Embedding decisions (e.g. \`rules/model-embed-related.md\`,
  \`rules/model-type-discriminator.md\`) when entities have 1:few or polymorphic relationships.
- Indexing strategies beyond path syntax (e.g. \`rules/index-composite.md\`,
  \`rules/index-composite-direction.md\`, \`rules/index-exclude-unused.md\`) when the access
  patterns include multi-property filters, ORDER BY, or large unindexed fields.

Use \`skillPath\` \`skills/cosmosdb-best-practices/SKILL.md\` for all calls. Do this BEFORE
emitting the final JSON — once you start producing JSON output you will not call tools again.

## Overview

Perform ALL of the following analyses for this domain and produce a complete Cosmos DB data model:

1. **Container Design** — Group entities into containers
2. **Partition Key Selection** — Choose optimal partition keys (including hierarchical if needed)
3. **Embedding Decisions** — Decide embed vs reference for relationships
4. **Access Pattern Mapping** — Map RDBMS patterns to Cosmos DB operations
5. **Cross-Partition Analysis** — Identify cross-partition queries and optimizations
6. **Indexing Policy Design** — Design indexing policies per container

---

## Step 1: Container Design

- Review tables, relationships, aggregate root, and access patterns from the domain summary.
- Group related entities into Cosmos DB containers. Co-locate entities queried together.
- Use a \`docType\` discriminator field to store multiple entity types per container.
- Keep strongly related entities (parent-child via FK) in the same container.
- Separate entities with very different access patterns or lifecycle.
- **Container names**: PascalCase (e.g., "Orders", "ProductCatalog")
- **Document field** and **\`docType\` discriminator field** names: camelCase (e.g., "orderId", "customerName")
- Every source table MUST appear as an entity in exactly one container.
- For entities that are fully embedded within another entity (embed strategy) and will NOT
  exist as standalone documents, set \`"isEmbeddedOnly": true\` on the entity. These entities
  do not need the container's partition key attribute.

### Document \`id\` strategy (CRITICAL — read carefully)

Every standalone Cosmos DB document needs an \`id\` field. The Cosmos DB best practice
(see \`rules/model-id-constraints.md\` in the skill) is to use **GUIDs by default** because
they are collision-free, opaque, evenly distributed, and decoupled from mutable business
data. Apply the following decision rule deterministically:

1. **DEFAULT — use a GUID for \`id\`.** Emit a single \`id\` attribute on the entity with:
   - \`"target": "id"\`, \`"type": "string"\`, \`"isId": true\`, \`"isPartitionKey": false\`
   - \`"source": { "table": "(generated)", "column": "(uuid)", "type": "uuid" }\`
   Then **also** keep the natural primary key as a **separate** attribute named after the
   entity (e.g. \`customerId\`, \`productId\`, \`salesOrderId\`) sourced from the PK column,
   with \`isId: false\`. This separate field is what cross-container references use and
   what application code queries as the business identifier. Type it to match the source
   column (numeric PKs stay numeric).

2. **EXCEPTION — natural-key \`id\`.** Use the natural PK value as \`id\` ONLY when ALL of
   the following hold:
   - The PK is a single column (not composite),
   - The PK is also the chosen partition key (so a point read by \`id\` + partition key
     is naturally efficient),
   - The PK value is safe as a Cosmos \`id\` (string-coercible, ≤1023 bytes, alphanumeric
     ASCII + \`-\`/\`_\`, no \`/\`, \`\\\\\`, \`?\`, \`#\`, no trailing spaces).
   In that case, emit **ONE** attribute carrying BOTH \`"isId": true\` AND
   \`"isPartitionKey": true\`, sourced from the PK column. Do **not** also emit a duplicate
   \`<entity>Id\` attribute from the same column.

**Forbidden patterns (do NOT do this):**

- Two attributes sourced from the **same** column (e.g. \`id\` and \`productId\` both
  sourced from \`ProductID\`). Either \`id\` is a GUID with source
  \`(generated)/(uuid)\` and the natural key lives in a separately named field, OR a
  single attribute carries both \`isId\` and \`isPartitionKey\`.
- \`id\` and a duplicate of it under another name with a different \`type\`
  (e.g. \`id: string\` + \`productId: number\`, both from \`ProductID\`).
- Natural-key \`id\` when the partition key is a **different** field. For example,
  Products partitioned by \`/productCategoryId\` MUST use a GUID \`id\` and keep
  \`productId\` as a separate queryable field — \`id\` is never the natural PK in that case.

**CRITICAL — Partition Key Alignment in Multi-DocType Containers:**
All documents in a Cosmos DB container share ONE partition key path. When placing multiple
entity types (docTypes) in the same container, every standalone entity (isEmbeddedOnly=false)
MUST include a field matching the container's partition key path. If a secondary entity does
not naturally carry the partition key value (e.g., a model entity in a container partitioned
by \`/productCategoryId\`), you MUST either:
  (a) mark it \`"isEmbeddedOnly": true\` (it lives only inside another entity's document), or
  (b) place it in a separate container with its own suitable partition key.
Do NOT create standalone documents that lack the container's partition key field.

## Step 2: Partition Key Selection

For EACH container:

- Identify 2–4 partition key candidates based on high cardinality, query alignment,
  avoiding hot partitions, and logical partition size under 20GB.
- Score candidates 0–100 on cardinality, query alignment, write distribution, and growth.
- Select the highest-scoring candidate.

### Hierarchical Partition Keys (HPK)

Cosmos DB supports up to 3 levels of hierarchical partition keys.

- **Recommend HPK when:** Multi-tenant workloads, natural hierarchy (tenant → user → session),
  single tenant could exceed 20GB, prefix-based queries are common.
- **Single key sufficient when:** One field has high cardinality, no partition near 20GB.
- **Critical rules:** Each level MUST have high cardinality. Query routing is PREFIX-BASED.
  For write-heavy workloads, first-level key needs thousands of unique values.

Common patterns:
- Single: ["/customerId"]
- Two-level: ["/tenantId", "/userId"]
- Three-level: ["/tenantId", "/userId", "/sessionId"]

Set \`isPartitionKey: true\` on selected attributes.

## Step 3: Embedding Decisions

For EACH relationship between entities:

- **Cardinality**: 1:1 or 1:few → embed. 1:many or many:many → reference.
- **Access pattern**: Read together → embed. Updated independently → reference.
- **Size risk**: Could exceed 2MB or grow unbounded → reference.
- Set \`strategy\` ("embed" or "reference") and \`rationale\` on each relationship.

## Step 4: Access Pattern Mapping

- Identify RDBMS access patterns (SQL queries, JOINs, stored procs, ORM methods)
  from the domain summary.
- Convert each to Cosmos DB NoSQL equivalent: point reads, SQL queries, batch ops,
  change feed patterns, stored procedures.
- Include the results in the summary only (not in the model JSON).

## Step 5: Cross-Partition Analysis

- Identify queries that fan out across partitions (WHERE clause doesn't filter by partition key).
- Estimate RU cost: low (~5-20 RU), medium (~20-100 RU), high (100+ RU).
- Suggest optimizations: materialized views, change feed, synthetic keys, caching.
- Include the results in the summary only (not in the model JSON).

## Step 6: Indexing Policy Design

**CRITICAL — Indexing path syntax:** The "Index Path Syntax" rule is appended verbatim
below the Domain Summary in this prompt. Read it carefully before authoring any path.
Using the wrong notation (e.g. \`/lineItems/*/productSnapshot/?\` with \`*\` mid-path)
causes container creation to fail with a BadRequest. The only valid mid-path array
notation is \`/[]/\`. The \`*\` wildcard is terminal-only.

For EACH container:

- Start with "/*" (index everything), selectively exclude large/unused paths.
- Create composite indexes for multi-property filters + sorts.
- Add full-text search if access patterns require it.
- Always exclude "/_etag/?" from indexing.
## Step 7: Throughput Recommendation

For EACH container, recommend an autoscale throughput setting:

- Estimate read and write operations per second from the access patterns.
- Use Cosmos DB RU cost guidelines: point read ~1 RU per 1KB item, point write ~5 RU,
  query 2.5–10+ RU depending on complexity.
- Calculate a baseline RU/s, then apply a 2x buffer for traffic spikes.
- Round up to the nearest 1000 RU/s (minimum autoscale max is 1000).
- Set "maxThroughput" on each container to the recommended autoscale maximum RU/s.
- For low-traffic containers (lookup tables, config, etc.) use the minimum 1000 RU/s.
- Include the throughput rationale in the summary only (not in the model JSON).
---

## Output Format

Respond with a JSON object in EXACTLY this format (no markdown, no code fences):
{
  "cosmosModel": {
    "domain": "DomainName",
    "sourceType": "${this.props.sourceType}",
    "containers": [
      {
        "name": "ContainerName",
        "partitionKeys": [
          {
            "path": "/partitionKeyPath"
          }
        ],
        "entities": [
          {
            "name": "EntityName",
            "docType": "type_discriminator",
            "sourceTable": "schema.table_name",
            "isEmbeddedOnly": false,
            "attributes": [
              {
                "target": "fieldName",
                "source": { "table": "table_name", "column": "col_name", "type": "source_type" },
                "type": "string",
                "isId": true,
                "isPartitionKey": false
              }
            ],
            "relationships": [
              {
                "targetEntity": "OtherEntity",
                "sourceFK": { "table": "table_name", "column": "fk_col" },
                "type": "one-to-many",
                "strategy": "embed",
                "rationale": "Read together, bounded cardinality"
              }
            ]
          }
        ],
        "indexingPolicy": {
          "indexingMode": "consistent",
          "automatic": true,
          "includedPaths": [{ "path": "/*" }],
          "excludedPaths": [{ "path": "/\\"_etag\\"/?" }],
          "compositeIndexes": [],
          "fullTextPolicy": null,
          "fullTextIndexes": null
        },
        "maxThroughput": 4000
      }
    ],
    "accessPatterns": [],
    "crossPartitionQueries": []
  },
  "summary": "# Schema Conversion Summary: DomainName\\n\\n## Overview\\n..."
}

## Summary Requirements (in the "summary" field)

Generate a comprehensive markdown summary that includes:

1. **Overview** — Brief domain summary and container count.
2. **Tables to Container Mapping** — A comprehensive mapping table showing every source
   table and which Cosmos DB container it maps to, its docType, partition key, and
   embed/reference strategy. Link to the full model: \`[cosmos-model.json](./cosmos-model.json)\`.
3. **Container Summary** — For each container: name, partition key, entity count,
   DocType strategy, key embedding decisions, and **example JSON documents** for each
   docType showing realistic sample data (not placeholder values).
4. **Access Pattern Mappings** — Group patterns into **Read Patterns** and **Write Patterns**.
   For each pattern include the RDBMS operation, the Cosmos DB equivalent, and a link to
   where the pattern was found in the source code (e.g., \`[FileName.cs#L42](path/to/FileName.cs#L42)\`).
5. **Partition Key Decisions** — Summary table of container → partition key with rationale.
6. **Embedding Strategy** — Summary of embed vs reference decisions with trade-offs.
7. **Cross-Partition Queries** — List with optimization strategies.
8. **Indexing Policies** — Summary per container.
9. **Optimization Recommendations** — Performance, cost, and model improvement tips.
10. **Throughput Recommendations** — Summary table of container → recommended autoscale max RU/s with rationale for the estimate.

This summary will be saved at \`${this.props.outputRelativePath}\` relative to the workspace root.

IMPORTANT:
- Every source table MUST appear as an entity in exactly one container
- partitionKeys is always an array, even for single keys
- Set isPartitionKey=true on the attribute matching the container partition key path in every STANDALONE entity (isEmbeddedOnly=false)
- Entities with isEmbeddedOnly=true do NOT need the partition key attribute
- The attribute marked isPartitionKey=true MUST have the same "target" name across all standalone entities in the container
- Partition keys are immutable — once a container is created, its partition key cannot be changed. To change the partition key, a new container must be created with the desired partition key, data migrated, and application code updated. Choose partition keys carefully as this is a breaking change.
- Set isId=true on primary keys
- The \`id\` attribute and any \`<entity>Id\` business-key attribute MUST NOT be sourced from the same source column. If you keep the natural primary key as a separate field, \`id\` MUST be a GUID (source: \`(generated)/(uuid)\`). If \`id\` is the natural primary key, do not also emit a duplicate \`<entity>Id\` attribute — collapse into a single attribute marked with both \`isId\` and \`isPartitionKey\`.
- Include relationships with strategy and rationale
- Do NOT include accessPatterns or crossPartitionQueries in the model JSON — include them in the summary only
- Do NOT include partition key candidates, scores, or analysis text in the model JSON — include candidate evaluation details in the summary under "Partition Key Decisions" instead. The model JSON partitionKeys entries should contain only the final "path".
- Include indexingPolicy on every container
- Include maxThroughput (autoscale max RU/s) on every container
- Your FINAL response must be ONLY the JSON object`,
                ),
            ),
            vscpp(
                UserMessage,
                { priority: 100 },
                vscpp(TextChunk, { priority: 95 }, '\n\n# Domain Summary\n\n'),
                vscpp(TextChunk, { priority: 90, breakOnWhitespace: false }, this.props.domainSummary),
                vscpp(
                    TextChunk,
                    { priority: 92 },
                    '\n\n# CRITICAL Reference: Cosmos DB Indexing Path Syntax\n\n' +
                        'The following rule is the authoritative reference for indexing path syntax. ' +
                        'You MUST follow it when authoring `includedPaths`, `excludedPaths`, and `compositeIndexes` ' +
                        "in any container's `indexingPolicy`.\n\n",
                ),
                vscpp(TextChunk, { priority: 92, breakOnWhitespace: false }, this.props.indexPathSyntaxRule),
                vscpp(
                    TextChunk,
                    { priority: 62 },
                    this.props.schemaConversionInstructions
                        ? '\n\n# ADDITIONAL SCHEMA CONVERSION INSTRUCTIONS (from the user)\n\n' +
                              this.props.schemaConversionInstructions +
                              '\n\n'
                        : '',
                ),
                vscpp(TextChunk, { priority: 60 }, '\n\n# Cosmos DB Best Practices Skill\n\n'),
                vscpp(TextChunk, { priority: 50, breakOnWhitespace: false }, this.props.bestPractices),
                vscpp(
                    TextChunk,
                    { priority: 45 },
                    '\n\nFor detailed guidance on any rule listed above, use the `loadSkillSupplementaryFile` tool with skillPath `skills/cosmosdb-best-practices/SKILL.md` and the relative path from the overview (e.g. `rules/partition-high-cardinality.md`).\n',
                ),
            ),
        );
    }
}
