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

// vscpp and vscppf are set on globalThis by @vscode/prompt-tsx when imported
declare const vscpp: (ctor: unknown, props: unknown, ...children: unknown[]) => PromptPiece;
declare const vscppf: { isFragment: boolean };

/**
 * Props for the MigrationCrossDomainPrompt element.
 */
interface Phase2Step3CrossDomainPromptProps extends BasePromptElementProps {
    domainSummary: string;
    crossDomainEdges: string;
    bestPractices: string;
}

/**
 * Prompt element for Phase 4 — analyzing cross-domain foreign key
 * dependencies and generating Cosmos DB migration recommendations
 * for each domain.
 */
export class Phase2Step3CrossDomainPrompt extends PromptElement<Phase2Step3CrossDomainPromptProps> {
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
                    `You are an expert database architect specializing in migrating relational databases to Azure Cosmos DB NoSQL.

Given the following domain decomposition and cross-domain foreign key relationships, provide:
1. How each cross-domain dependency should be handled during migration (denormalization, reference documents, Change Feed materialized views, etc.)
2. Specific Cosmos DB recommendations for each domain

Respond with a JSON object:
{
  "crossDomainDependencies": [
    {
      "relationship": "TableA.col (DomainX) → TableB.col (DomainY)",
      "strategy": "string - how to handle this in Cosmos DB"
    }
  ],
  "domainRecommendations": {
    "DomainName": ["recommendation 1", "recommendation 2"]
  },
  "summary": "string - overall migration assessment summary"
}

IMPORTANT: Respond ONLY with the JSON object.`,
                ),
            ),
            vscpp(
                UserMessage,
                { priority: 100 },
                vscpp(TextChunk, { priority: 95 }, '\n\n## Domains\n\n'),
                vscpp(
                    TextChunk,
                    { priority: 90, breakOnWhitespace: true },
                    this.props.domainSummary || '(no domain summary available)',
                ),
                vscpp(TextChunk, { priority: 85 }, '\n\n## Cross-Domain Foreign Keys\n\n'),
                vscpp(
                    TextChunk,
                    { priority: 80, breakOnWhitespace: true },
                    this.props.crossDomainEdges || '(none detected)',
                ),
                vscpp(TextChunk, { priority: 75 }, '\n\n## Cosmos DB Best Practices\n\n'),
                vscpp(
                    TextChunk,
                    { priority: 70, breakOnWhitespace: true },
                    this.props.bestPractices || '(no best practices available)',
                ),
            ),
        );
    }
}
