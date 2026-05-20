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

interface Phase3Step2PartitionKeyPromptProps extends BasePromptElementProps {
    domainSummary: string;
    cosmosModel: string;
    bestPractices: string;
    schemaConversionInstructions: string;
}

/**
 * Sub-step 2 of Schema Conversion: Partition Key Selection.
 * Evaluates partition key candidates and scores by criteria.
 * Output: partition-key.md analysis + updated cosmos-model.json with partitionKeys array per container.
 */
export class Phase3Step2PartitionKeyPrompt extends PromptElement<Phase3Step2PartitionKeyPromptProps> {
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
                    `You are an expert Azure Cosmos DB NoSQL architect. Your task is to select optimal
partition keys for each container in the Cosmos DB data model.

## Instructions

For EACH container in the current cosmos model:

1. **Identify candidates** — List 2-4 partition key candidates based on:
   - High cardinality (many distinct values for even distribution)
   - Alignment with the most frequent query patterns (point reads, range scans)
   - Avoiding hot partitions (no skewed data distribution)
   - Logical partition size staying under 20GB

2. **Score candidates** — Rate each candidate 0-100 on:
   - Cardinality & distribution evenness
   - Query pattern alignment (filters in WHERE clauses)
   - Write distribution across partitions
   - Growth characteristics

3. **Select the best** — Choose the highest-scoring candidate. Discard any candidate
   scoring below 70 unless it is the only candidate for that container. Then evaluate
   whether hierarchical partition keys (HPK) would benefit this container.

### Hierarchical Partition Keys (HPK)

Cosmos DB supports hierarchical partition keys with up to 3 levels of depth
(also called subpartitioning). HPK uses MultiHash partitioning where each level
of the hierarchy contributes to the partition key path.

**When to recommend HPK:**
- Multi-tenant workloads where a single tenant could exceed 20GB
- Data has a natural hierarchy (e.g., tenant → user → session)
- You want to eliminate synthetic/composite partition key complexity
- Prefix-based queries are common (e.g., "all data for tenant X")

**When a single key is sufficient:**
- One field already has high cardinality and aligns with query patterns
- No logical partition is expected to approach 20GB
- The workload does not have a natural hierarchical structure

**Critical HPK design rules:**
- Each level (especially the first) MUST have high cardinality. A low-cardinality
  first-level key concentrates ALL writes onto a single physical partition until
  it exceeds 50GB and splits, which can take 4-6 hours.
- Query routing is PREFIX-BASED. Queries are efficient only when they filter on
  all levels or a prefix of the hierarchy:
  • TenantId + UserId + SessionId → single-partition query (best)
  • TenantId + UserId → targeted cross-partition (efficient)
  • TenantId → targeted cross-partition (efficient)
  • UserId alone (skipping TenantId) → full fan-out query (expensive!)
  • SessionId alone → full fan-out query (expensive!)
- For write-heavy workloads, use a first-level key with at least thousands
  of unique values.
- Consider using item ID as the last level when even the combination of higher
  levels might exceed 20GB.

**Common HPK patterns:**
- Single key: ["/customerId"] — high cardinality, aligns with queries
- Two-level: ["/tenantId", "/userId"] — multi-tenant with per-user queries
- Three-level: ["/tenantId", "/userId", "/sessionId"] — deep isolation

4. **Mark attributes** — Set isPartitionKey=true on each entity attribute used as
   a partition key level.

**CRITICAL — Multi-DocType Partition Key Alignment:**
All documents in a Cosmos DB container share ONE partition key path. In containers
with multiple entity types (docTypes), every STANDALONE entity (isEmbeddedOnly=false)
MUST include an attribute whose \`target\` matches the container's partition key path.
Entities marked \`isEmbeddedOnly: true\` are exempt — they exist only as nested
objects/arrays within another entity's document and do not need the partition key.
If a secondary entity does not naturally carry the partition key value (e.g., a model
entity in a container partitioned by \`/productCategoryId\`), it must either be marked
\`isEmbeddedOnly: true\` or placed in a separate container. Do NOT mark different
attributes as isPartitionKey on different entities within the same container.

## Output Format

Respond with a JSON object in EXACTLY this format (no markdown, no code fences):
{
  "analysis": "## Partition Key Analysis\\n\\n### ContainerName\\n\\n| Candidate | Score | Rationale |\\n...",
  "updatedModel": { <full updated cosmos-model.json with partitionKeys added to each container> }
}

The "analysis" field should contain a detailed markdown analysis with a table per container.
Include a recommendation on whether to use single or hierarchical partition keys with justification.

The "updatedModel" field should be the COMPLETE cosmos-model.json with a "partitionKeys" ARRAY
added to each container. Each element represents one level of the hierarchical partition key.
Most containers will have a single element; use multiple only when HPK is justified:
  "partitionKeys": [
    {
      "path": "/selectedPath"
    }
  ]

Do NOT include "candidates" or "analysis" in the partitionKeys entries of the model JSON.
Include candidate evaluation details (scores, rationale, and justifications) in the "analysis"
markdown field instead.

IMPORTANT:
- partitionKeys is always an array, even for single partition keys
- Use at most 3 levels for hierarchical partition keys
- Order levels from broadest (highest in hierarchy) to most specific
- Set isPartitionKey=true on each selected attribute in the entities
- The attribute marked isPartitionKey=true MUST have the same "target" name across all STANDALONE entities (isEmbeddedOnly=false) in the container
- Entities with isEmbeddedOnly=true do NOT need the partition key attribute
- Do NOT recommend HPK unless the workload clearly benefits from it
- Partition keys are immutable — once a container is created, its partition key cannot be changed. To change the partition key configuration, a new container must be created with the desired partition key, the data copied over, and application code updated. Flag this as a critical design consideration in the analysis.
- Your FINAL response must be ONLY the JSON object.`,
                ),
            ),
            vscpp(
                UserMessage,
                { priority: 100 },
                vscpp(TextChunk, { priority: 95 }, '\n\n# Domain Summary\n\n'),
                vscpp(TextChunk, { priority: 90, breakOn: /\s+/g }, this.props.domainSummary),
                vscpp(TextChunk, { priority: 85 }, '\n\n# Current Cosmos DB Data Model\n\n'),
                vscpp(TextChunk, { priority: 80 }, this.props.cosmosModel),
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
                vscpp(TextChunk, { priority: 50, breakOn: /\s+/g }, this.props.bestPractices),
                vscpp(
                    TextChunk,
                    { priority: 45 },
                    '\n\nFor detailed guidance on any rule listed above, use the `loadSkillSupplementaryFile` tool with skillPath `skills/cosmosdb-best-practices/SKILL.md` and the relative path from the overview (e.g. `rules/partition-high-cardinality.md`).\n',
                ),
            ),
        );
    }
}
