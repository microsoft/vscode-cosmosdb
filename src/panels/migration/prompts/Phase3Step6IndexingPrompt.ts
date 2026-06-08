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
    indexPathSyntaxRule: string;
    schemaConversionInstructions: string;
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

## Required Preparation (BEFORE producing any output)

You have access to a \`loadSkillSupplementaryFile\` tool that can load detailed indexing rules
from the Cosmos DB best practices skill. Before drafting the policy, call this tool (you may
batch multiple calls in one round) to load any indexing rules from the skill overview that are
relevant to the current model — for example \`rules/index-composite.md\`,
\`rules/index-composite-direction.md\`, \`rules/index-exclude-unused.md\`, or
\`rules/index-spatial.md\`. Use \`skillPath\` \`skills/cosmosdb-best-practices/SKILL.md\` for all calls.
Do this BEFORE emitting the final JSON — once you start producing JSON output you will not
call tools again.

**CRITICAL — Indexing path syntax:** The "Index Path Syntax" rule is appended verbatim
below the current data model in this prompt. Read it carefully before authoring any path.
Using the wrong notation (e.g. \`/lineItems/*/productSnapshot/?\` with \`*\` mid-path)
causes container creation to fail with a BadRequest. The only valid mid-path array
notation is \`/[]/\`. The \`*\` wildcard is terminal-only.

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

IMPORTANT: Your FINAL response must be ONLY the JSON object.`,
                ),
            ),
            vscpp(
                UserMessage,
                { priority: 100 },
                vscpp(TextChunk, { priority: 95 }, '\n\n# Domain Summary\n\n'),
                vscpp(TextChunk, { priority: 90, breakOn: /\s+/g }, this.props.domainSummary),
                vscpp(TextChunk, { priority: 85 }, '\n\n# Current Cosmos DB Data Model\n\n'),
                vscpp(TextChunk, { priority: 80 }, this.props.cosmosModel),
                vscpp(
                    TextChunk,
                    { priority: 92 },
                    '\n\n# CRITICAL Reference: Cosmos DB Indexing Path Syntax\n\n' +
                        'The following rule is the authoritative reference for indexing path syntax. ' +
                        'You MUST follow it when authoring `includedPaths`, `excludedPaths`, and `compositeIndexes`.\n\n',
                ),
                vscpp(TextChunk, { priority: 92, breakOn: /\s+/g }, this.props.indexPathSyntaxRule),
                vscpp(
                    TextChunk,
                    { priority: 62 },
                    this.props.schemaConversionInstructions
                        ? '\n\n# ADDITIONAL SCHEMA CONVERSION INSTRUCTIONS (from the user)\n\n' +
                              this.props.schemaConversionInstructions +
                              '\n\n'
                        : '',
                ),
                vscpp(TextChunk, { priority: 60 }, '\n\n# Cosmos DB Best Practices Skill\n\n'),
                vscpp(TextChunk, { priority: 50, breakOn: /\s+/g }, this.props.bestPractices),
                vscpp(
                    TextChunk,
                    { priority: 45 },
                    '\n\nFor detailed guidance on any rule listed above, use the `loadSkillSupplementaryFile` tool with skillPath `skills/cosmosdb-best-practices/SKILL.md` and the relative path from the overview (e.g. `rules/partition-high-cardinality.md`).\n',
                ),
            ),
        );
    }
}
