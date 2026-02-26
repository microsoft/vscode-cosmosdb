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

interface Phase3Step7SummaryPromptProps extends BasePromptElementProps {
    domainName: string;
    cosmosModel: string;
    partitionKeyAnalysis: string;
    embeddingAnalysis: string;
    accessPatternsAnalysis: string;
    crossPartitionAnalysis: string;
    indexingAnalysis: string;
}

/**
 * Sub-step 7 of Schema Conversion: Summary.
 * Generates a comprehensive summary of all schema conversion results for a domain.
 */
export class Phase3Step7SummaryPrompt extends PromptElement<Phase3Step7SummaryPromptProps> {
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
                    `You are an expert Azure Cosmos DB NoSQL architect. Generate a comprehensive summary
of the schema conversion results for the "${this.props.domainName}" domain.

## Instructions

Create a well-structured markdown document that:

1. **Overview** — Brief summary of the domain and how many containers were designed.

2. **Container Summary** — For each container:
   - Name, partition key, and entity count
   - DocType strategy overview
   - Key embedding decisions

3. **Partition Key Decisions** — Summary table of container → partition key with rationale.

4. **Embedding Strategy** — Summary of embed vs reference decisions with key trade-offs.

5. **Access Pattern Mappings** — Summary table of RDBMS → Cosmos DB operation conversions.

6. **Cross-Partition Queries** — List any queries that require cross-partition fan-out
   with their optimization strategies.

7. **Indexing Policies** — Summary of indexing decisions per container.

8. **Optimization Recommendations** — Any additional recommendations for performance,
   cost reduction, or data model improvements.

9. **File References** — List the output files with brief descriptions:
   - cosmos-model.json — Full data model mapping
   - partition-key.md — Partition key analysis
   - embedding-recommendation.md — Embedding strategy analysis
   - access-patterns.md — Access pattern conversions
   - domain-cross-partition-analysis.md — Cross-partition query analysis
   - index-policy.json — Indexing policies

Respond with ONLY the markdown content. Do NOT wrap in JSON or code fences.`,
                ),
            ),
            vscpp(
                UserMessage,
                { priority: 100 },
                vscpp(TextChunk, { priority: 95 }, '\n\n# Final Cosmos DB Data Model (cosmos-model.json)\n\n'),
                vscpp(TextChunk, { priority: 90, breakOnWhitespace: true }, this.props.cosmosModel),
                vscpp(TextChunk, { priority: 85 }, '\n\n# Partition Key Analysis\n\n'),
                vscpp(
                    TextChunk,
                    { priority: 80, breakOnWhitespace: true },
                    this.props.partitionKeyAnalysis || '(not available)',
                ),
                vscpp(TextChunk, { priority: 75 }, '\n\n# Embedding Analysis\n\n'),
                vscpp(
                    TextChunk,
                    { priority: 70, breakOnWhitespace: true },
                    this.props.embeddingAnalysis || '(not available)',
                ),
                vscpp(TextChunk, { priority: 65 }, '\n\n# Access Pattern Conversions\n\n'),
                vscpp(
                    TextChunk,
                    { priority: 60, breakOnWhitespace: true },
                    this.props.accessPatternsAnalysis || '(not available)',
                ),
                vscpp(TextChunk, { priority: 55 }, '\n\n# Cross-Partition Analysis\n\n'),
                vscpp(
                    TextChunk,
                    { priority: 50, breakOnWhitespace: true },
                    this.props.crossPartitionAnalysis || '(not available)',
                ),
                vscpp(TextChunk, { priority: 45 }, '\n\n# Indexing Analysis\n\n'),
                vscpp(
                    TextChunk,
                    { priority: 40, breakOnWhitespace: true },
                    this.props.indexingAnalysis || '(not available)',
                ),
            ),
        );
    }
}
