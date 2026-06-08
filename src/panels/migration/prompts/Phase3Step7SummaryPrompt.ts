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
    outputRelativePath: string;
    schemaConversionInstructions: string;
    /**
     * Content of `volumetrics.md` from Phase 1 discovery, when present.
     * Used to ground the per-domain throughput and storage estimates in the
     * summary. When absent or empty, the summary must tag estimates as
     * `[default assumed]` and note that volumetrics were unavailable.
     */
    volumetricsMd?: string;
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
   - **Example documents** — For each document type (docType) in this container, include a
     realistic sample JSON document showing the full structure including partition key, id,
     docType discriminator, all attributes, and any embedded sub-documents. Use plausible
     sample data (not placeholder values like "string" or "0").

3. **Partition Key Decisions** — Summary table of container → partition key with rationale.

3. **Embedding Strategy** — Summary of embed vs reference decisions with key trade-offs.

4. **Access Pattern Mappings** — Summary table of RDBMS → Cosmos DB operation conversions.

5. **Cross-Partition Queries** — List any queries that require cross-partition fan-out
   with their optimization strategies.

6. **Indexing Policies** — Summary of indexing decisions per container.

7. **Optimization Recommendations** — Any additional recommendations for performance,
   cost reduction, or data model improvements.

8. **Throughput & Storage Recommendations** — Two tables grounded in the volumetrics
   attached below (when present). Do NOT add an "Estimate Disclaimer" section — a fixed
   one is appended automatically.

   - **Throughput** table: \`Container | Baseline RU/s | Buffer | Recommended max RU/s | Inputs\`.
     Inputs precedence: (1) access patterns + Step 4/5 buckets → query shape; (2) volumetrics
     → TPS/magnitudes; (3) Workload Notes → refinements/overrides (win on conflict).
     Costs: point read ≈1 RU/KB; point write ≈5–10 RU/KB (+1–2/indexed property); 1-partition
     query 2.5–10+ RU; cross-partition per Step 5 bucket. Buffer = ×2, or ×3 if growth >10%
     or notes flag spiky/seasonal; size against peak if peak/avg ratio given. Round up to
     nearest 1000 RU/s (min 1000). Tag each row's **Inputs** with \`[access patterns]\`,
     \`[volumetrics]\`, \`[workload notes]\`, and/or \`[default assumed]\`.

   - **Storage** table: \`Container | Current rows | Avg item size (KB) | JSON inflation | Index overhead | 12-mo storage (GB) | Inputs\`.
     Method: JSON inflation 1.2× narrow / 1.5× typical / 2.0–2.5× wide-or-arrays; fold
     \`isEmbeddedOnly\` entities into parent size (× multiplicity); +10–20% index (default
     +15%); +~100 B metadata; 12-mo = current × (1 + monthlyGrowth)^12 (flat if absent);
     TTL caps replace compounding; flag P95/P99 nearing 2 MB. If volumetrics.md is missing,
     leave numeric cells blank, tag \`[default assumed]\`, and note storage is unavailable.

9. **File References** — List the output files with brief descriptions:
   - cosmos-model.json — Full data model mapping
   - partition-key.md — Partition key analysis
   - embedding-recommendation.md — Embedding strategy analysis
   - access-patterns.md — Access pattern conversions
   - domain-cross-partition-analysis.md — Cross-partition query analysis
   - index-policy.json — Indexing policies

This summary will be saved at \`${this.props.outputRelativePath}\` relative to the workspace root.
All referenced files live in the same directory as the summary. When generating markdown
links to these files, use ONLY relative links (e.g. \`[cosmos-model.json](./cosmos-model.json)\`) — never absolute paths.

Respond with ONLY the markdown content. Do NOT wrap in JSON or code fences.
Your response MUST begin with a Markdown heading (\`#\`). Do not include any preamble,
thinking, or commentary before the heading.`,
                ),
            ),
            vscpp(
                UserMessage,
                { priority: 100 },
                vscpp(TextChunk, { priority: 95 }, '\n\n# Final Cosmos DB Data Model (cosmos-model.json)\n\n'),
                vscpp(TextChunk, { priority: 90 }, this.props.cosmosModel),
                vscpp(TextChunk, { priority: 85 }, '\n\n# Partition Key Analysis\n\n'),
                vscpp(
                    TextChunk,
                    { priority: 80, breakOn: /\s+/g },
                    this.props.partitionKeyAnalysis || '(not available)',
                ),
                vscpp(TextChunk, { priority: 75 }, '\n\n# Embedding Analysis\n\n'),
                vscpp(TextChunk, { priority: 70, breakOn: /\s+/g }, this.props.embeddingAnalysis || '(not available)'),
                vscpp(TextChunk, { priority: 65 }, '\n\n# Access Pattern Conversions\n\n'),
                vscpp(
                    TextChunk,
                    { priority: 60, breakOn: /\s+/g },
                    this.props.accessPatternsAnalysis || '(not available)',
                ),
                vscpp(TextChunk, { priority: 55 }, '\n\n# Cross-Partition Analysis\n\n'),
                vscpp(
                    TextChunk,
                    { priority: 50, breakOn: /\s+/g },
                    this.props.crossPartitionAnalysis || '(not available)',
                ),
                vscpp(TextChunk, { priority: 45 }, '\n\n# Indexing Analysis\n\n'),
                vscpp(TextChunk, { priority: 40, breakOn: /\s+/g }, this.props.indexingAnalysis || '(not available)'),
                vscpp(
                    TextChunk,
                    { priority: 38 },
                    '\n\n# Volumetrics (from discovery)\n\n' +
                        (this.props.volumetricsMd && this.props.volumetricsMd.trim().length > 0
                            ? 'PRIMARY source of magnitudes for the Throughput & Storage section. Workload Notes (bottom) override code-inferred values when explicit.\n\n'
                            : 'No `volumetrics.md` was provided. Tag every estimate row `[default assumed]` and note that storage figures are unavailable.\n\n'),
                ),
                vscpp(
                    TextChunk,
                    { priority: 38, breakOnWhitespace: false },
                    this.props.volumetricsMd && this.props.volumetricsMd.trim().length > 0
                        ? this.props.volumetricsMd
                        : '',
                ),
                vscpp(
                    TextChunk,
                    { priority: 35 },
                    this.props.schemaConversionInstructions
                        ? '\n\n# ADDITIONAL SCHEMA CONVERSION INSTRUCTIONS (from the user)\n\n' +
                              this.props.schemaConversionInstructions +
                              '\n\n'
                        : '',
                ),
            ),
        );
    }
}
