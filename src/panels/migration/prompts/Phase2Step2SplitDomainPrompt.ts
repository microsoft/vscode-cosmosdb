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
 * Props for the MigrationSplitDomainPrompt element.
 */
interface Phase2Step2SplitDomainPromptProps extends BasePromptElementProps {
    domainName: string;
    tableCount: number;
    estimatedTokens: number;
    tokenThreshold: number;
    subgraph: string;
    bestPractices: string;
}

/**
 * Prompt element for Phase 3 — splitting an oversized domain into
 * smaller, cohesive sub-domains when a domain's schema exceeds the
 * token budget.
 */
export class Phase2Step2SplitDomainPrompt extends PromptElement<Phase2Step2SplitDomainPromptProps> {
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
                    `You are an expert database architect. The following domain "${this.props.domainName}" contains ` +
                        `${this.props.tableCount} tables and exceeds the token budget ` +
                        `(${this.props.estimatedTokens.toLocaleString()} tokens, limit: ${this.props.tokenThreshold.toLocaleString()}).\n\n` +
                        `Split this domain into smaller, cohesive sub-domains. Each sub-domain should:\n` +
                        `- Contain tables that are strongly related by foreign keys\n` +
                        `- Remain a meaningful business unit\n` +
                        `- Be named clearly (e.g., "${this.props.domainName}-Core", "${this.props.domainName}-History")\n` +
                        `- Respect Cosmos DB constraints (e.g., 20GB logical partition limit, single-partition transactions)\n\n` +
                        `## Cosmos DB Best Practices\n${this.props.bestPractices}\n\n` +
                        `## Subgraph\n${this.props.subgraph}\n\n` +
                        `Respond with a JSON object:\n` +
                        `{\n  "subDomains": [\n    {\n` +
                        `      "name": "string",\n      "description": "string",\n` +
                        `      "tables": ["table1", "table2"],\n` +
                        `      "rationale": "string",\n      "aggregateRoot": "string"\n` +
                        `    }\n  ]\n}\n\nIMPORTANT: Respond ONLY with the JSON object.`,
                ),
            ),
        );
    }
}
