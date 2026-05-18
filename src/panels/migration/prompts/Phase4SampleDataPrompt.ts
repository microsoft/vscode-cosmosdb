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

2. **Construct each \`id\` from the entity's \`idTemplate\` in the model.**
   - Every standalone entity has an \`idTemplate\` (e.g. \`"customer-{CustomerID}"\`,
     \`"salesOrderDetail-{SalesOrderID}-{SalesOrderDetailID}"\`). Pick realistic
     values for the referenced source PK column(s) and substitute them into the
     template: \`CustomerID=101\` → \`id: "customer-101"\`.
   - When \`idTemplate\` is \`"{GuidCol}"\` (native GUID PK), generate realistic
     GUID strings and use them directly as \`id\`.
   - When \`idTemplate\` is \`"{uuid}"\` (generated-GUID fallback for entities
     without a usable PK), generate a fresh GUID string as \`id\`; there is no
     corresponding natural-key field to align.
   - The natural-key field on the same document (e.g. \`customerId: 101\`) MUST hold
     the SAME value you substituted into the template, with the type declared in
     the model.

3. **Generate 3-5 sample documents per entity type** in each container. Each document must:
   - Include all mapped attributes with realistic, domain-appropriate values
   - Include the \`docType\` discriminator field matching the entity's docType value
   - Include a valid \`id\` field constructed via the rule in step 2. IDs must be
     strings, max 1,023 bytes, must NOT contain \`/\` or \`\\\\\` (also avoid \`?\`,
     \`#\`, trailing spaces). Use only alphanumeric ASCII + hyphens.
   - Set partition key fields to realistic values that demonstrate good distribution
   - For embedded relationships (strategy: "embed"), nest the related entity's data
     as a sub-document or array within the parent document
   - For referenced relationships (strategy: "reference"), the foreign-key field
     holds the referenced document's NATURAL KEY value (e.g. \`customerId: 101\`),
     NOT its derived \`id\`. Cross-container joins are on the natural key.
   - Use appropriate JSON types: strings for text, numbers for numeric values,
     booleans for flags, arrays for collections

4. **Ensure referential consistency** — for every reference field (e.g. \`customerId\`
   on an Order), there must be a document in the referenced container whose
   natural-key field of the same name holds that exact value (and whose \`id\` is
   the prefixed form per its \`idTemplate\`).

5. **Use realistic values** — Use plausible names, addresses, dates (ISO 8601),
   email addresses, monetary amounts, etc. Do not use placeholder text like "string"
   or "value1".

6. **Respect Cosmos DB constraints**:
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
      "containerName": "Customers",
      "items": [
        { "id": "customer-101", "docType": "customer", "customerId": 101, ... },
        { "id": "customer-102", "docType": "customer", "customerId": 102, ... }
      ]
    }
  ]
}

(IDs are derived from each entity's \`idTemplate\` — never freshly generated GUIDs.
The natural-key field on the same document, e.g. \`customerId: 101\`, holds the
verbatim source PK value.)

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
