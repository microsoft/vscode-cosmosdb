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

interface Phase3Step4AccessPatternsPromptProps extends BasePromptElementProps {
    domainSummary: string;
    cosmosModel: string;
    bestPractices: string;
}

/**
 * Sub-step 4 of Schema Conversion: Access Pattern Analysis.
 * Analyzes RDBMS access patterns (SQL queries, stored procs, ORM calls) and
 * documents how they map to Cosmos DB NoSQL API operations.
 * Output: markdown analysis only — does not update cosmos-model.json.
 */
export class Phase3Step4AccessPatternsPrompt extends PromptElement<Phase3Step4AccessPatternsPromptProps> {
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
                    `You are an expert Azure Cosmos DB NoSQL architect. Your task is to analyze RDBMS
access patterns and document how they map to Cosmos DB NoSQL API operations.

## Instructions

1. **Identify RDBMS access patterns** — From the domain summary's "Access Patterns"
   section, extract all documented access patterns. Each pattern may include:
   - A SQL example (in a \`\`\`sql code block) — use this as the source RDBMS operation
   - An application code example (in a \`\`\`csharp code block) — use this to understand
     the application's intent and how the data is accessed programmatically
   - Code references (file paths) — note these for traceability
   Also identify any additional SQL queries, JOIN operations, stored procedures,
   ORM repository methods, or API endpoints mentioned elsewhere in the domain summary.

2. **Convert each pattern** — For each RDBMS access pattern, describe the equivalent
   Cosmos DB NoSQL operation:
   - Point reads (ReadItemAsync by id + partition key) for single-entity lookups
   - SQL queries (SELECT * FROM c WHERE ...) for filtered reads
   - Batch operations for multi-document writes within a partition
   - Change feed patterns for cross-container materialized views
   - Stored procedures for transactional multi-document operations

3. **Identify the target container** and whether the operation is a point read, query,
   or cross-partition query.

4. **Estimate RU cost** per operation (point read ≈ 1 RU, query varies).

If no access patterns are found in the domain summary, infer the most common CRUD
operations based on the entity structure and relationships.

## Output Format

Respond with a markdown document. For each access pattern, include:
- Pattern name
- Source RDBMS operation (SQL query, stored proc, ORM method)
- Target Cosmos DB operation (point read, query, batch, change feed)
- Target container
- Whether it is a cross-partition query
- Estimated RU cost
- Any migration notes or caveats

Example structure:

## Access Pattern Analysis

### GetOrderWithItems

| | Source (RDBMS) | Target (Cosmos DB) |
|---|---|---|
| **Type** | SQL JOIN query | Point Read |
| **Operation** | SELECT o.*, oi.* FROM Orders o JOIN OrderItems oi ... | ReadItemAsync(id, partitionKey) |
| **Container** | — | Orders |
| **Cross-Partition** | N/A | No |
| **Estimated RU** | — | ~1 RU |

**Notes:** With embedded order items, the JOIN is eliminated.

IMPORTANT: Respond ONLY with the markdown content, no JSON wrapping, no code fences.`,
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
