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

interface Phase3Step5CrossPartitionPromptProps extends BasePromptElementProps {
    domainSummary: string;
    cosmosModel: string;
    bestPractices: string;
}

/**
 * Sub-step 5 of Schema Conversion: Cross-Partition Analysis.
 * Identifies all cross-partition queries, estimates RU costs, and suggests optimizations.
 * Output: markdown analysis only — does not update cosmos-model.json.
 */
export class Phase3Step5CrossPartitionPrompt extends PromptElement<Phase3Step5CrossPartitionPromptProps> {
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
                    `You are an expert Azure Cosmos DB NoSQL architect. Your task is to identify ALL
cross-partition queries and estimate their RU costs.

## Instructions

1. **Review access patterns** — From the domain summary and current cosmos model,
   identify every query that must fan out across multiple partitions.

2. **Identify cross-partition scenarios** — A query is cross-partition when:
   - The WHERE clause does NOT filter by the partition key
   - The query needs data from multiple logical partitions
   - Aggregations span the entire container

3. **Estimate RU cost** — Rate each cross-partition query:
   - "low" (~5-20 RU): Small container, few partitions
   - "medium" (~20-100 RU): Moderate data, several partitions
   - "high" (100+ RU): Large container, many partitions, complex predicates

4. **Suggest optimizations** for each cross-partition query:
   - Create a materialized view container with a different partition key
   - Use Change Feed to maintain denormalized lookup data
   - Add a synthetic partition key combining multiple fields
   - Consider hierarchical partition keys
   - Cache frequently-accessed cross-partition results
   - Accept the cost if the query is infrequent

## Output Format

Respond with a markdown document. For each cross-partition query, include:
- Query name
- Container
- The Cosmos DB SQL query
- Why it is cross-partition (which partition key is not in the WHERE clause)
- Estimated RU cost (low / medium / high with approximate RU range)
- Suggested optimizations

Example structure:

## Cross-Partition Query Analysis

### SearchByDate

| | Details |
|---|---|
| **Container** | Orders |
| **Query** | SELECT * FROM c WHERE c.date >= @start |
| **Reason** | date is not the partition key (partitioned by /customerId) |
| **Estimated RU** | High (~100+ RU) |

**Optimizations:**
- Create a date-partitioned lookup container maintained via Change Feed
- Cache results for frequently queried date ranges

If no cross-partition queries are identified, state that all queries are
well-aligned with their partition keys.

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
