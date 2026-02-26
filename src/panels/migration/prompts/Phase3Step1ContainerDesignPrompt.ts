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

interface Phase3Step1ContainerDesignPromptProps extends BasePromptElementProps {
    domainSummary: string;
    bestPractices: string;
    sourceType: string;
}

/**
 * Sub-step 1 of Schema Conversion: Container Design.
 * Designs Cosmos DB containers and entity groupings from the RDBMS domain assessment.
 * Output: cosmos-model.json with containers, entities, docType, and attribute mappings.
 *
 * This step does NOT produce relationships, access patterns, or cross-partition queries.
 * Those are added by subsequent sub-steps (Embedding, Access Patterns, Cross-Partition).
 */
export class Phase3Step1ContainerDesignPrompt extends PromptElement<Phase3Step1ContainerDesignPromptProps> {
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
                    `You are an expert Azure Cosmos DB NoSQL architect. Your task is to design Cosmos DB
containers and entity groupings for a domain being migrated from a relational database.

## Instructions

1. **Analyze the domain** — Review the tables, relationships, aggregate root, and access
   patterns from the assessment domain summary below.

2. **Design containers** — Group related entities into Cosmos DB containers. Consider:
   - Co-locating entities that are queried together in the same container
   - Using a DocType discriminator field to store multiple entity types per container
   - Keeping strongly related entities (parent-child via FK) in the same container
   - Separating entities that have very different access patterns or lifecycle

3. **Map attributes** — For each source RDBMS table, map columns to Cosmos DB document
   attributes. Use camelCase for JSON document field names (target attributes).
   Mark the primary key attribute with "isId": true.

## Naming Conventions

- **Container names**: Use PascalCase (e.g., "Orders", "ProductCatalog", "CustomerProfiles")
- **Document field names** (target attributes): Use camelCase (e.g., "orderId", "customerName")

## Output Format

Respond with a JSON object in EXACTLY this format (no markdown, no code fences):
{
  "version": 1,
  "domain": "DomainName",
  "sourceType": "${this.props.sourceType}",
  "containers": [
    {
      "name": "ContainerName",
      "entities": [
        {
          "name": "EntityName",
          "docType": "type_discriminator_value",
          "sourceTable": "schema.table_name",
          "attributes": [
            {
              "target": "cosmosFieldName",
              "source": { "table": "table_name", "column": "column_name", "type": "source_db_type" },
              "type": "string | number | boolean | object | array",
              "isId": true
            }
          ]
        }
      ]
    }
  ]
}

IMPORTANT:
- Every source table in the domain MUST appear as an entity in exactly one container
- Use camelCase for target attribute names
- The "sourceTable" should use the fully-qualified name (schema.table)
- Include an "id" attribute mapped from the primary key with "isId": true
- Do NOT include relationships, accessPatterns, or crossPartitionQueries — those are handled by subsequent steps
- Respond ONLY with the JSON object`,
                ),
            ),
            vscpp(
                UserMessage,
                { priority: 100 },
                vscpp(TextChunk, { priority: 95 }, '\n\n# Domain Summary\n\n'),
                vscpp(TextChunk, { priority: 90, breakOnWhitespace: true }, this.props.domainSummary),
                vscpp(TextChunk, { priority: 60 }, '\n\n# Cosmos DB Best Practices\n\n'),
                vscpp(TextChunk, { priority: 50, breakOnWhitespace: true }, this.props.bestPractices),
            ),
        );
    }
}
