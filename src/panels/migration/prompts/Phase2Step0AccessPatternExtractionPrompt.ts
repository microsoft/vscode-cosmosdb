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
 * Props for the access pattern extraction prompt element.
 */
interface Phase2Step0AccessPatternExtractionPromptProps extends BasePromptElementProps {
    discoveryReport: string;
}

/**
 * Prompt element that extracts structured access patterns from a free-form
 * discovery report markdown document.
 *
 * This runs as the first sub-step of Phase 2 (Assessment), allowing users
 * to edit the discovery report between Phase 1 and Phase 2. The AI parses
 * the (potentially hand-edited) report and returns structured JSON.
 */
export class Phase2Step0AccessPatternExtractionPrompt extends PromptElement<Phase2Step0AccessPatternExtractionPromptProps> {
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
                    `You are a database migration assistant. Your task is to extract ALL access patterns
from the following discovery report into a structured JSON format.

RULES:
- Extract EVERY access pattern described in the report. Do not skip any.
- Preserve the original pattern names, table names, and code references exactly as written.
- For each pattern, determine the query type (read, write, or read-write) and frequency
  (high, medium, or low) from the report content.
- If a field is not mentioned or not applicable, use sensible defaults:
  type defaults to "read", frequency defaults to "medium".
- Code references should be file names or paths. If the report says "None found" or
  similar, use an empty array.
- Extract SQL examples and code examples (any language) when present.

Respond with a JSON object in EXACTLY this format:
{
  "accessPatterns": [
    {
      "name": "string — the access pattern name/identifier as written in the report",
      "type": "string — one of: read, write, read-write",
      "tables": ["string — table/entity names involved"],
      "frequency": "string — one of: high, medium, low",
      "codeReferences": ["string — file names or paths referenced in the report"],
      "sqlExample": "string | null — example SQL query if present",
      "codeExample": "string | null — example application code if present"
    }
  ]
}

IMPORTANT: Respond ONLY with the JSON object. Do not wrap it in a code block.
Do not include any explanation before or after the JSON.`,
                ),
            ),
            vscpp(
                UserMessage,
                { priority: 100 },
                vscpp(
                    TextChunk,
                    { priority: 95 },
                    '\n\n# Discovery Report\n\nExtract all access patterns from the following report:\n\n',
                ),
                vscpp(
                    TextChunk,
                    { priority: 90, breakOnWhitespace: true },
                    this.props.discoveryReport || '(empty discovery report)',
                ),
            ),
        );
    }
}
