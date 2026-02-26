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

3. **Select the best** — Choose the highest-scoring candidate. Then evaluate whether
   hierarchical partition keys (HPK) would benefit this container.

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
      "path": "/selectedPath",
      "candidates": [
        { "path": "/path", "score": 85, "rationale": "reason" }
      ],
      "analysis": "brief justification for selecting this level"
    }
  ]

IMPORTANT:
- partitionKeys is always an array, even for single partition keys
- Use at most 3 levels for hierarchical partition keys
- Order levels from broadest (highest in hierarchy) to most specific
- Set isPartitionKey=true on each selected attribute in the entities
- Do NOT recommend HPK unless the workload clearly benefits from it
- Respond ONLY with the JSON object.`,
                ),
            ),
            vscpp(
                UserMessage,
                { priority: 100 },
                vscpp(TextChunk, { priority: 95 }, '\n\n# Domain Summary\n\n'),
                vscpp(TextChunk, { priority: 90, breakOnWhitespace: true }, this.props.domainSummary),
                vscpp(TextChunk, { priority: 85 }, '\n\n# Current Cosmos DB Data Model\n\n'),
                vscpp(TextChunk, { priority: 80, breakOnWhitespace: true }, this.props.cosmosModel),
                vscpp(TextChunk, { priority: 60 }, '\n\n# Cosmos DB Best Practices\n\n'),
                vscpp(TextChunk, { priority: 50, breakOnWhitespace: true }, this.props.bestPractices),
            ),
        );
    }
}
