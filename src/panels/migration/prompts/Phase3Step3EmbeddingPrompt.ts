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
    schemaConversionInstructions: string;
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

1. **Evaluate embedding criteria** — Answer these questions for each relationship:
   - **Cardinality**: 1:1 or 1:few → favors embed. 1:many or many:many → favors reference.
   - **Access pattern**: Are parent and child typically read together? → favors embed.
   - **Update independence**: Is the child frequently updated on its own? → favors reference.
   - **Size risk**: Could embedding cause documents to exceed 2MB or grow unbounded? → favors reference.

2. **Decision** — Embed when cardinality is low, data is read together, and size stays bounded.
   Reference when cardinality is high, child is updated independently, or embedding risks unbounded growth.

3. **Update relationships** — Set strategy ("embed" or "reference") and rationale
   on each relationship in the cosmos model.

4. **Handle embedded entities** — When embedding, show that the child entity's attributes
   will appear as a nested object/array within the parent entity.
   **IMPORTANT:** When an entity is fully embedded within another entity and will NOT exist
   as a standalone document, set \`"isEmbeddedOnly": true\` on that entity. This signals
   that the entity is exempt from partition key alignment checks.

## Output Format

Respond with a JSON object in EXACTLY this format (no markdown, no code fences):
{
  "analysis": "## Embedding Strategy Analysis\\n\\n### Relationship: Parent → Child\\n\\n| Criterion | Score | Notes |\\n...",
  "updatedModel": { <full updated cosmos-model.json with strategy, score, rationale on each relationship> }
}

The "analysis" field should contain detailed markdown explaining the decision per relationship.
The "updatedModel" field should be the COMPLETE cosmos-model.json with each relationship updated:
  {
    "targetEntity": "...",
    "sourceFK": { ... },
    "type": "...",
    "strategy": "embed | reference",
    "rationale": "Embedded because parent and child are always read together..."
  }

IMPORTANT: Respond ONLY with the JSON object.`,
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
