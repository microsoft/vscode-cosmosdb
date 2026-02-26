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

interface Phase3Step3EmbeddingPromptProps extends BasePromptElementProps {
    domainSummary: string;
    cosmosModel: string;
    bestPractices: string;
}

/**
 * Sub-step 3 of Schema Conversion: Embedding Decisions.
 * Decides embed vs reference for each relationship with scoring.
 * Output: embedding-recommendation.md analysis + updated cosmos-model.json with strategy per relationship.
 */
export class Phase3Step3EmbeddingPrompt extends PromptElement<Phase3Step3EmbeddingPromptProps> {
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
                    `You are an expert Azure Cosmos DB NoSQL architect. Your task is to decide the
embedding strategy (embed vs reference) for each relationship in the data model.

## Instructions

For EACH relationship in the current cosmos model:

1. **Evaluate embedding criteria** — Score each relationship on these factors:
   - **Read together** (0-25): Are parent and child typically read together?
   - **Write frequency** (0-25): How often is the child updated independently?
   - **Data size** (0-25): Will embedding cause documents to exceed 2MB or grow unbounded?
   - **Cardinality** (0-25): 1:1 and 1:few favor embedding; 1:many and many:many favor referencing

2. **Total score** — Sum the four criteria (0-100). Higher = embed, lower = reference.
   - Score ≥ 60: Embed (store child data as nested array/object in parent document)
   - Score < 60: Reference (store only the foreign key; child lives in separate document or container)

3. **Update relationships** — Set strategy ("embed" or "reference"), score, and rationale
   on each relationship in the cosmos model.

4. **Handle embedded entities** — When embedding, show that the child entity's attributes
   will appear as a nested object/array within the parent entity.

## Output Format

Respond with a JSON object in EXACTLY this format (no markdown, no code fences):
{
  "analysis": "## Embedding Strategy Analysis\\n\\n### Relationship: Parent → Child\\n\\n| Criterion | Score | Notes |\\n...",
  "updatedModel": { <full updated cosmos-model.json with strategy, score, rationale on each relationship> }
}

The "analysis" field should contain detailed markdown with a scoring table per relationship.
The "updatedModel" field should be the COMPLETE cosmos-model.json with each relationship updated:
  {
    "targetEntity": "...",
    "sourceFK": { ... },
    "type": "...",
    "strategy": "embed | reference",
    "score": 75,
    "rationale": "Embedded because parent and child are always read together..."
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
