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
    /**
     * Content of `volumetrics.md` from Phase 1 discovery, when present.
     * Grounds RU/storage estimates in real row counts, average row size,
     * read/write TPS, monthly growth, and optional Workload Notes.
     * When absent or empty, the model must fall back to heuristic defaults
     * and tag throughput/storage rows as `[default assumed]`.
     */
    volumetricsMd?: string;
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

### Document \`id\` strategy (CRITICAL — migration scenario)

Cosmos \`id\` MUST be deterministically derived from the source PK so imports
are idempotent and every document traces back to its source row. Fresh GUIDs
break this — do NOT use them unless rules 1 and 2 below cannot apply.

Rule (every standalone entity, \`isEmbeddedOnly\` !== true):

1. **DEFAULT — prefixed derived id:**
   - \`id = "{entityCamelCase}-{pk1}[-{pk2}-...]"\`
     Customer/101 → \`"customer-101"\`;
     SalesOrderDetail/71774,110562 → \`"salesOrderDetail-71774-110562"\`.
   - Encode as ONE \`id\` attribute (\`"type": "string"\`, \`"isId": true\`,
     \`source\` = first PK column) PLUS an \`idTemplate\` on the entity using
     EXACT source column names in braces: \`"customer-{CustomerID}"\`.
   - Sanitize composite PK string values: replace \`/\`, \`\\\\\`, \`?\`, \`#\`,
     trailing whitespace with \`-\`.

2. **EXCEPTION — native GUID/UUID PK** (\`uniqueidentifier\`, \`uuid\`):
   Use the GUID value directly, no prefix.
   \`idTemplate\`: \`"{rowguid}"\`. \`source.type\`: \`"uniqueidentifier"\`.

3. **FALLBACK — generated GUID** (only when rules 1 and 2 cannot apply, e.g.
   the source table has no PK, or its PK is unsafe as a Cosmos \`id\` and has
   no stable string projection):
   - Emit \`id\` with \`source: { "table": "(generated)", "column": "(uuid)", "type": "uuid" }\`.
   - \`idTemplate\`: \`"{uuid}"\`.
   - State the reason in the schema summary so re-imports are reviewed manually.

ALSO: preserve every source PK column as a SEPARATE camelCase attribute
(\`customerId: number\`, \`salesOrderId: number\`) sourced from the PK column
with \`isId: false\`. These hold the verbatim natural-key value used by
application queries and cross-container references.

**Forbidden:**
- Freshly generated GUID \`id\` when rule 1 or 2 applies
- Omitting the natural PK column(s) as separate attributes (when a PK exists)
- Omitting \`idTemplate\` on a standalone entity

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

Set \`maxThroughput\` (autoscale max RU/s) per container, using layered inputs and tagging
each number's source in the summary table's **Inputs** column with
\`[access patterns]\`, \`[volumetrics]\`, \`[workload notes]\`, and/or \`[default assumed]\`.

Input precedence (lower wins on conflicts):
1. Access patterns + Step 4/5 buckets → query *shape* (point read, query, cross-partition).
2. Volumetrics (\`volumetrics.md\`, below) → *magnitudes* (TPS, row counts, item KB, growth).
3. Workload Notes (free-form section at bottom of volumetrics.md) → refinements/overrides
   (peak/avg, TTL, P95/P99, read/write mix, hot partitions). **Workload Notes win** on conflict.

If volumetrics.md is empty/missing, use modest defaults (~1 KB items, low TPS) and tag
every row \`[default assumed]\`.

RU costs: point read ≈1 RU/KB; point write ≈5–10 RU/KB (+1–2 RU per indexed property over
baseline); single-partition query 2.5–10+ RU; cross-partition query uses the Step 5 bucket
(low 5–20, medium 20–100, high 100+) × query rate.

Sizing per container: sum (per-op RU × TPS) → baseline → ×2 buffer (×3 if monthly growth
>10% or Workload Notes flag spiky/seasonal; if peak/avg ratio given, size against peak with
no extra buffer) → round up to nearest 1000 RU/s (min 1000; lookup/config containers = 1000).

## Step 8: Storage Estimation

Set \`estimatedRowCount\` (current) and \`estimatedStorageGB\` (12-month projection) per
container. Omit both if volumetrics.md is missing — do **not** fabricate.

\`rowCount\` and \`avgRowSize\` are per *source table*. Respect Step 3 decisions when rolling
up to containers: \`isEmbeddedOnly\` entities fold into their parent's doc size (× typical
multiplicity); split entities contribute their portion; non-embedded children live in their
own container.

Per-container formula:
1. **JSON inflation** of avg row size: ~1.2× narrow scalar rows, ~1.5× typical, ~2.0–2.5×
   wide / many strings / arrays. State the factor + one-line rationale per entity.
2. **+10–20% index overhead** (default +15%; higher with many composite indexes).
3. **+~100 B metadata** per document.
4. **Current bytes** = Σ over standalone entities of
   \`rowCount × (inflated_doc_size × (1 + index_overhead) + metadata_bytes)\`.
5. **12-mo projection** = current × \`(1 + monthlyGrowth)^12\` (flat if growth absent).
6. **TTL cap**: if Workload Notes specify retention, cap at TTL steady-state instead of
   compounding indefinitely. State the cap.
7. **P95/P99 flag**: if P95/P99 item size nears the 2 MB limit, flag the container; don't
   inflate the average.
8. \`estimatedRowCount\` = sum of standalone entity rowCounts (embedded-only excluded).
9. \`estimatedStorageGB\` = 12-mo projection in GB (1 GB = 1024³ bytes), 2 sig figs.
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
            "idTemplate": "entityName-{PKColumn}",
            "attributes": [
              {
                "target": "id",
                "source": { "table": "table_name", "column": "PKColumn", "type": "int" },
                "type": "string",
                "isId": true
              },
              {
                "target": "entityNameId",
                "source": { "table": "table_name", "column": "PKColumn", "type": "int" },
                "type": "number"
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
        "maxThroughput": 4000,
        "estimatedRowCount": 1500000,
        "estimatedStorageGB": 4.8
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
10. **Throughput & Storage Recommendations** — Two tables (per Steps 7 & 8 above):
    - Throughput: \`Container | Baseline RU/s | Buffer | Recommended max RU/s | Inputs\`.
      Tag Inputs with \`[access patterns]\`/\`[volumetrics]\`/\`[workload notes]\`/\`[default assumed]\`.
    - Storage: \`Container | Current rows | Avg item size (KB) | JSON inflation | Index overhead | 12-mo storage (GB) | Inputs\`.
      Note TTL caps or P95/P99 warnings inline. Do NOT add an "Estimate Disclaimer" — appended automatically.

This summary will be saved at \`${this.props.outputRelativePath}\` relative to the workspace root.

IMPORTANT:
- Every source table MUST appear as an entity in exactly one container
- partitionKeys is always an array, even for single keys
- Set isPartitionKey=true on the attribute matching the container partition key path in every STANDALONE entity (isEmbeddedOnly=false)
- Entities with isEmbeddedOnly=true do NOT need the partition key attribute
- The attribute marked isPartitionKey=true MUST have the same "target" name across all standalone entities in the container
- Partition keys are immutable — once a container is created, its partition key cannot be changed. To change the partition key, a new container must be created with the desired partition key, data migrated, and application code updated. Choose partition keys carefully as this is a breaking change.
- Set isId=true on primary keys
- Set \`idTemplate\` on every standalone entity (isEmbeddedOnly !== true), using EXACT source column names in braces (e.g. \`"customer-{CustomerID}"\`, \`"salesOrderDetail-{SalesOrderID}-{SalesOrderDetailID}"\`, \`"{rowguid}"\` for native GUID PKs, or \`"{uuid}"\` only as fallback when no usable PK exists).
- The \`id\` attribute MUST be derived from source PK columns via \`idTemplate\` (or be the value of a native GUID PK; fallback is a generated GUID). Every source PK column MUST also appear as a SEPARATE camelCase attribute typed to match the source (e.g. \`customerId: number\` alongside \`id: string\` "customer-101").
- Include relationships with strategy and rationale
- Do NOT include accessPatterns or crossPartitionQueries in the model JSON — include them in the summary only
- Do NOT include partition key candidates, scores, or analysis text in the model JSON — include candidate evaluation details in the summary under "Partition Key Decisions" instead. The model JSON partitionKeys entries should contain only the final "path".
- Include indexingPolicy on every container
- Include maxThroughput (autoscale max RU/s) on every container
- Include estimatedRowCount and estimatedStorageGB on every container when volumetrics.md is provided; omit both when volumetrics are absent (do not fabricate)
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
                    { priority: 85 },
                    '\n\n# Volumetrics (from discovery)\n\n' +
                        (this.props.volumetricsMd && this.props.volumetricsMd.trim().length > 0
                            ? 'PRIMARY source of magnitudes for Steps 7 & 8. Workload Notes (bottom) override code-inferred values when explicit.\n\n'
                            : 'No `volumetrics.md` was provided. Use defaults, tag estimate rows `[default assumed]`, and omit `estimatedStorageGB`/`estimatedRowCount` from container JSON.\n\n'),
                ),
                vscpp(
                    TextChunk,
                    { priority: 85, breakOnWhitespace: false },
                    this.props.volumetricsMd && this.props.volumetricsMd.trim().length > 0
                        ? this.props.volumetricsMd
                        : '',
                ),
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
