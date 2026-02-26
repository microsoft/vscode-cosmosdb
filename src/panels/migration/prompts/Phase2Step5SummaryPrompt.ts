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

interface Phase2Step5SummaryPromptProps extends BasePromptElementProps {
    domainFileList: string;
    domainSummary: string;
    crossDomainEdges: string;
    crossDomainStrategies: string;
    domainRecommendations: string;
    outputRelativePath: string;
}

/**
 * Prompt element for Phase 2 assessment summary generation.
 * Takes all domain decomposition results and cross-domain analysis
 * and produces a comprehensive markdown summary document.
 */
export class Phase2Step5SummaryPrompt extends PromptElement<Phase2Step5SummaryPromptProps> {
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
                    `You are an expert database architect. Generate a comprehensive markdown summary
of a relational-to-Cosmos DB migration assessment.

## Instructions

Create a well-structured markdown document with these sections:

1. **Overview** — A brief paragraph summarizing the assessment: how many domains were
   identified, the overall migration complexity, and key findings.

2. **Domains** — For each domain, write a concise summary of its purpose, the tables it
   contains, and its estimated token size. Include a relative markdown link to the
   domain's analysis file using the paths provided below.

3. **Cross-Domain Dependency Analysis** — Describe the cross-domain foreign key
   relationships found and the recommended strategy for handling each one during
   migration (denormalization, reference documents, Change Feed, etc.).

4. **Recommendations** — Summarize the per-domain Cosmos DB migration recommendations.

The assessment summary will be saved at \`${this.props.outputRelativePath}\` relative to the
workspace root. Domain analysis files live in a \`domains/\` subfolder next to the summary.
When generating markdown links to domain files, compute paths relative to the summary
file's location (e.g. \`domains/<DomainName>.md\`). Use ONLY relative links — never absolute paths.

Respond with ONLY the markdown content. Do NOT wrap in JSON or code fences.
Start the document with a top-level heading "# Migration Assessment Summary".`,
                ),
            ),
            vscpp(
                UserMessage,
                { priority: 100 },
                vscpp(
                    TextChunk,
                    { priority: 95 },
                    '\n\n# Domain File List\n\nRelative paths to each domain analysis file:\n\n',
                ),
                vscpp(
                    TextChunk,
                    { priority: 90, breakOnWhitespace: true },
                    this.props.domainFileList || '(no domain files)',
                ),
                vscpp(TextChunk, { priority: 85 }, '\n\n# Domain Summaries\n\n'),
                vscpp(
                    TextChunk,
                    { priority: 80, breakOnWhitespace: true },
                    this.props.domainSummary || '(no domain summary available)',
                ),
                vscpp(TextChunk, { priority: 75 }, '\n\n# Cross-Domain Foreign Keys\n\n'),
                vscpp(
                    TextChunk,
                    { priority: 70, breakOnWhitespace: true },
                    this.props.crossDomainEdges || '(none detected)',
                ),
                vscpp(TextChunk, { priority: 65 }, '\n\n# Cross-Domain Dependency Strategies\n\n'),
                vscpp(
                    TextChunk,
                    { priority: 60, breakOnWhitespace: true },
                    this.props.crossDomainStrategies || '(none)',
                ),
                vscpp(TextChunk, { priority: 55 }, '\n\n# Per-Domain Recommendations\n\n'),
                vscpp(
                    TextChunk,
                    { priority: 50, breakOnWhitespace: true },
                    this.props.domainRecommendations || '(none)',
                ),
            ),
        );
    }
}
