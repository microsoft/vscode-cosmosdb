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
 * Props for the MigrationAssessmentPrompt element.
 */
interface Phase2Step1AssessmentPromptProps extends BasePromptElementProps {
    dependencyGraph: string;
    discoveryReport: string;
    accessPatterns: string;
    bestPractices: string;
    schemaGroups: string;
}

/**
 * Prompt element for the Assessment (Step 2) domain decomposition.
 *
 * Takes the dependency graph, discovery report, access patterns, and
 * Cosmos DB best practices, then asks the AI to perform domain decomposition:
 * identify bounded contexts, group tables, estimate token sizes, split
 * large domains, and generate re-architecture recommendations.
 */
export class Phase2Step1AssessmentPrompt extends PromptElement<Phase2Step1AssessmentPromptProps> {
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
                    `You are an expert database architect specializing in Domain-Driven Design (DDD) and
migrating relational databases to Azure Cosmos DB NoSQL.

Your task is to perform DOMAIN IDENTIFICATION using DDD bounded context analysis on the
source database schema. This is Phase 1 of a multi-phase assessment — focus ONLY on
identifying domains. Do NOT estimate tokens, split domains, or provide migration recommendations.

Analyze the dependency graph, discovery report, and access patterns to identify bounded contexts.
You MUST include ALL domains in your response. Do NOT skip or omit any domain.

GROUNDING RULES:
- If the dependency graph includes a "Schema Groups" section, use those schema boundaries
  as your STARTING POINT for domain identification. Each source schema typically maps to
  one domain. You may merge schemas that are tightly coupled by FK relationships or split
  a schema that serves clearly distinct business functions, but you MUST justify any
  deviation from the original schema boundaries in the rationale.
- When schema groups are available, the expected number of domains should be close to the
  number of schemas (±2). If your count differs significantly, explicitly explain why.
- Every table from the dependency graph must appear in EXACTLY ONE domain.
  No table may be omitted or duplicated. The total table count across all domains
  must equal the total table count in the dependency graph.
- If no schema groups are present, identify domains purely from FK relationships,
  access patterns, and business domain analysis.

1. **Identify Bounded Contexts** — Group related tables into logical domains based on:
   - Foreign key relationships (tightly coupled tables belong together)
   - Access patterns (tables frequently queried together should be co-located)
   - Business domain boundaries (e.g., Orders, Inventory, Users, Payments)
   - Aggregate root patterns (identify the primary entity each group revolves around)

2. **Group Tables into Domains** — Each domain should contain:
   - Tables that are strongly connected by foreign keys
   - Tables that participate in common transactions
   - Tables accessed together in typical application queries

3. **Name Domains** — Give each domain a clear, descriptive name in PascalCase based on the business function
   (e.g., "OrderManagement", "UserAccounts", "InventoryTracking").

4. **Sort Domains** — Return the domains array sorted in alphabetical order by domain name.

5. **Provide Rationale** — For each domain, explain WHY these tables belong together,
   referencing specific FK relationships, access patterns, or business logic.

6. **Identify Aggregate Root** — For each domain, identify the primary table/entity that
   serves as the aggregate root — the main entry point for queries and transactions.

Note: Access patterns from the discovery report will be assigned to domains automatically
after domain identification. You do NOT need to include them in your response.

Respond with a JSON object in EXACTLY this format:
{
  "domains": [
    {
      "name": "string - domain name",
      "description": "string - brief description of the domain's business function",
      "tables": ["table1", "table2"],
      "rationale": "string - why these tables form a bounded context",
      "aggregateRoot": "string - the primary table/entity in this domain"
    }
  ]
}

IMPORTANT: Respond ONLY with the JSON object. Do not wrap it in a code block.`,
                ),
            ),
            vscpp(
                UserMessage,
                { priority: 100 },
                vscpp(
                    TextChunk,
                    { priority: 95 },
                    '\n\n# Dependency Graph\n\nThe following shows all tables and their foreign key relationships:\n\n',
                ),
                vscpp(
                    TextChunk,
                    { priority: 93, breakOnWhitespace: true },
                    this.props.schemaGroups
                        ? '\n\n# Source Schema Groups\n\nThe source database organizes tables into the following ' +
                              'schemas/namespaces. Use these as your STARTING POINT for domain identification:\n\n' +
                              this.props.schemaGroups +
                              '\n\n'
                        : '',
                ),
                vscpp(
                    TextChunk,
                    { priority: 90, breakOnWhitespace: true },
                    this.props.dependencyGraph || '(no dependency graph available)',
                ),
                vscpp(
                    TextChunk,
                    { priority: 85 },
                    '\n\n# Discovery Report\n\nThe following is the discovery report from the initial analysis:\n\n',
                ),
                vscpp(
                    TextChunk,
                    { priority: 80, breakOnWhitespace: true },
                    this.props.discoveryReport || '(no discovery report available)',
                ),
                vscpp(
                    TextChunk,
                    { priority: 75 },
                    '\n\n# Access Patterns\n\nThe following are additional known access patterns for the application:\n\n',
                ),
                vscpp(
                    TextChunk,
                    { priority: 70, breakOnWhitespace: true },
                    this.props.accessPatterns || '(no access patterns available)',
                ),
                vscpp(
                    TextChunk,
                    { priority: 60 },
                    '\n\n# Azure Cosmos DB Best Practices\n\nApply these best practices when making recommendations:\n\n',
                ),
                vscpp(
                    TextChunk,
                    { priority: 50, breakOnWhitespace: true },
                    this.props.bestPractices || '(no best practices available)',
                ),
            ),
        );
    }
}
