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

interface Phase3Step6IndexingPromptProps extends BasePromptElementProps {
    domainSummary: string;
    cosmosModel: string;
    bestPractices: string;
}

/**
 * Sub-step 6 of Schema Conversion: Indexing Design.
 * Designs indexing policy per container (include/exclude paths, composite, full-text).
 */
export class Phase3Step6IndexingPrompt extends PromptElement<Phase3Step6IndexingPromptProps> {
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
                    `You are an expert Azure Cosmos DB NoSQL architect. Your task is to design the
indexing policy for each container in the data model.

## Instructions

For EACH container in the current cosmos model:

1. **Analyze access patterns** — Review the accessPatterns and crossPartitionQueries
   to determine which attributes are used in:
   - WHERE clause filters
   - ORDER BY clauses
   - JOIN operations
   - Aggregate functions (COUNT, SUM, AVG)
   - Full-text search queries

2. **Design included paths** — Include paths that are frequently queried.
   Start with "/*" (index everything) and selectively exclude large or unused paths.

3. **Design excluded paths** — Exclude paths that are:
   - Never used in queries (large text blobs, binary data)
   - Only read after a point-read (no filtering needed)

4. **Composite indexes** — Create composite indexes for queries that:
   - Filter on multiple properties AND sort by another
   - Use ORDER BY on multiple properties
   - Format: arrays of { path, order } objects

5. **Full-text search** — If any access pattern requires full-text search:
   - Add a fullTextPolicy with the appropriate language
   - Add fullTextIndexes for the paths that need search

## Output Format

Respond with a JSON object in EXACTLY this format (no markdown, no code fences):
{
  "analysis": "## Indexing Policy Design\\n\\n### Container: ContainerName\\n\\n...",
  "updatedModel": { <full updated cosmos-model.json with indexingPolicy added to each container> }
}

The "analysis" field should explain the reasoning for each indexing decision.
The "updatedModel" field must be the COMPLETE cosmos-model.json with indexingPolicy
added to each container:
  "indexingPolicy": {
    "indexingMode": "consistent",
    "automatic": true,
    "includedPaths": [{ "path": "/*" }],
    "excludedPaths": [{ "path": "/\\"_etag\\"/?" }],
    "compositeIndexes": [
      [
        { "path": "/field1", "order": "ascending" },
        { "path": "/field2", "order": "descending" }
      ]
    ],
    "fullTextPolicy": { "defaultLanguage": "en-US", "paths": ["/description"] },
    "fullTextIndexes": [{ "path": "/description" }]
  }

IMPORTANT: Respond ONLY with the JSON object.`,
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
