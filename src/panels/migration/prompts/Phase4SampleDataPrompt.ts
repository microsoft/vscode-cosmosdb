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

interface Phase4SampleDataPromptProps extends BasePromptElementProps {
    cosmosModel: string;
    schemaSummary: string;
    sourceType: string;
    bestPractices: string;
}

/**
 * Phase 4: Sample Data Generation.
 * Generates realistic sample JSON documents for each container/entity in the
 * Cosmos DB model produced by Phase 3 Schema Conversion.
 *
 * Output: JSON array of { containerName, items } objects.
 */
export class Phase4SampleDataPrompt extends PromptElement<Phase4SampleDataPromptProps> {
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
                    `You are an expert Azure Cosmos DB data engineer. Your task is to generate realistic
sample JSON documents for a Cosmos DB NoSQL database that was designed by migrating
from a ${this.props.sourceType} relational database.

## Instructions

1. **Review the Cosmos DB model** below — it defines containers, entities, attributes,
   partition keys, and relationships (with embedding/reference strategies).

2. **Choose an \`id\` strategy** by inspecting the Schema Conversion Summary (summary.md)
   and the Cosmos DB model below:
   - **Default to GUIDs** (e.g. \`"a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"\`) for every
     container's \`id\` field. GUIDs are the Cosmos DB best-practice default — they
     are collision-free, opaque, evenly distributed, and decoupled from mutable
     business data.
   - **Only deviate from GUIDs** if the summary or model explicitly indicates a
     stable natural key should be the document \`id\` (for example: the summary
     calls out a business identifier as the primary key, the model maps a source
     PK column directly onto \`id\`, or the partition-key + id pair is documented
     as a composite natural key). In that case, use compact alphanumeric ASCII +
     hyphens (e.g. \`"ORD-2026-0001"\`) — never raw values that may contain
     forbidden characters.
   - **Preserve the original business key as a separate field** on the document
     (e.g. \`customerNumber\`, \`orderNumber\`, \`sku\`) whenever you use a GUID
     \`id\`. This keeps the human-readable identifier queryable without coupling
     it to the document identity.
   - Apply the **same strategy consistently within a container**. Do not mix
     GUID and natural-key \`id\`s in the same container.

3. **Generate 3-5 sample documents per entity type** in each container. Each document must:
   - Include all mapped attributes with realistic, domain-appropriate values
   - Include the \`docType\` discriminator field matching the entity's docType value
   - Include a valid \`id\` field following the strategy chosen in step 2.
     IDs must be strings, max 1,023 bytes, must NOT contain / or \\ characters
     (also avoid ?, #, and trailing spaces). Use only alphanumeric ASCII characters
     plus hyphens for best SDK and connector interoperability.
   - Set partition key fields to realistic values that demonstrate good distribution
   - For embedded relationships (strategy: "embed"), nest the related entity's data
     as a sub-document or array within the parent document
   - For referenced relationships (strategy: "reference"), the foreign-key field
     must contain the referenced document's \`id\` value (whatever form it takes —
     GUID or natural key). Do not invent a parallel readable identifier for
     references.
   - Use appropriate JSON types: strings for text, numbers for numeric values,
     booleans for flags, arrays for collections

4. **Ensure referential consistency** — IDs used in references must match across
   containers exactly. For every reference field (e.g. \`customerId\` on an Order),
   there must be a document in the referenced container whose \`id\` equals that value.

4. **Use realistic values** — Use plausible names, addresses, dates (ISO 8601),
   email addresses, monetary amounts, etc. Do not use placeholder text like "string"
   or "value1".

7. **Respect Cosmos DB constraints**:
   - Document \`id\`: string, max 1,023 bytes, no / or \\ chars, no ? or # chars,
     no trailing spaces. Strongly prefer alphanumeric ASCII + hyphens only.
   - The partition key + id uniquely identifies a document — ensure no duplicates
     within the same logical partition.
   - Keep individual documents well under the 2 MB item size limit.
   - Partition key values: max 2,048 bytes. Use high-cardinality values for
     even distribution across logical partitions.

## Output Format

Respond with a JSON object in EXACTLY this format (no markdown, no code fences):
{
  "sampleData": [
    {
      "containerName": "ContainerName",
      "items": [
        { "id": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "docType": "EntityType", "partitionKeyField": "value", ... },
        { "id": "f0e1d2c3-b4a5-4968-8778-9a0b1c2d3e4f", "docType": "EntityType", "partitionKeyField": "value", ... }
      ]
    }
  ]
}

(IDs shown as GUIDs above per the default strategy in step 2; use natural-key
strings instead only when the schema summary indicates so.)

IMPORTANT:
- Every container in the model MUST have a corresponding entry in the output
- Every entity type within a container must have at least 3 sample documents
- Document field names must use camelCase matching the "target" attributes in the model
- Your FINAL response must be ONLY the JSON object, no additional text`,
                ),
            ),
            vscpp(
                UserMessage,
                { priority: 100 },
                vscpp(TextChunk, { priority: 100 }, '\n\n# Cosmos DB Model (model.json)'),
                vscpp(TextChunk, { priority: 100 }, this.props.cosmosModel || '(no model available)'),
            ),
            vscpp(
                UserMessage,
                { priority: 80 },
                vscpp(
                    TextChunk,
                    { priority: 80 },
                    '\n\n# Schema Conversion Summary (summary.md)\n\nUse this for additional context on the design decisions, embedding/reference rationale, and domain semantics behind the model above.\n\n',
                ),
                vscpp(
                    TextChunk,
                    { priority: 70, breakOn: /\s+/g },
                    this.props.schemaSummary || '(no schema summary available)',
                ),
            ),
            vscpp(
                UserMessage,
                { priority: 50 },
                vscpp(
                    TextChunk,
                    { priority: 50 },
                    '\n\n# Azure Cosmos DB Best Practices Skill\n\nApply these guidelines when generating sample data:\n\n',
                ),
                vscpp(
                    TextChunk,
                    { priority: 40, breakOn: /\s+/g },
                    this.props.bestPractices || '(no best practices available)',
                ),
                vscpp(
                    TextChunk,
                    { priority: 35 },
                    '\n\nFor detailed guidance on any rule listed above, use the `loadSkillSupplementaryFile` tool with skillPath `skills/cosmosdb-best-practices/SKILL.md` and the relative path from the overview (e.g. `rules/partition-high-cardinality.md`).\n',
                ),
            ),
        );
    }
}
