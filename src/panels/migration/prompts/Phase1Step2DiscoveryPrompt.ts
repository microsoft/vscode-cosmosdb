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
 * Props for the MigrationDiscoveryPrompt element.
 */
interface Phase1Step2DiscoveryPromptProps extends BasePromptElementProps {
    hasAccessPatternFiles: boolean;
    hasVolumetricFiles: boolean;
    outputRelativePath: string;
    language: string;
    frameworks: string[];
    databaseAccess: string;
}

/**
 * Prompt element for the discovery report generation step.
 *
 * This is the system prompt used in the agentic tool-calling loop that
 * explores schema files, workspace source code, and optional access-pattern
 * / volumetric files to produce a comprehensive discovery report.
 */
export class Phase1Step2DiscoveryPrompt extends PromptElement<Phase1Step2DiscoveryPromptProps> {
    render(_state: void, _sizing: PromptSizing): PromptPiece {
        const accessPatternNote = this.props.hasAccessPatternFiles
            ? `\n\nYou also have access to user-provided access pattern files via listAccessPatternFiles and\nreadAccessPatternFile. Read these first as they contain known access patterns that should\nbe incorporated into your analysis.`
            : '';

        const volumetricNote = this.props.hasVolumetricFiles
            ? `\n\nVolumetric data files are available via listVolumetricFiles and readVolumetricFile.\nThese contain quantitative data such as query logs, AWR reports, or usage statistics.\nUse this data to refine your frequency estimates and identify high-impact access patterns.`
            : '';

        return vscpp(
            vscppf,
            null,
            vscpp(
                UserMessage,
                { priority: 200 },
                vscpp(
                    TextChunk,
                    null,
                    `You are a database migration assistant specializing in migrating relational databases to Azure Cosmos DB NoSQL.

You have access to tools that let you explore the project's database schema files and
the application's source code.

Start by calling listSchemaFiles to see what is available, then call readSchemaFile
for each file you need to understand the schema. You don't have to read every file
at once — read them in batches if there are many.${accessPatternNote}${volumetricNote}

IMPORTANT — SCHEMA-FIRST APPROACH:
Your primary goal is to produce access patterns for ALL tables, entities, and
relationships defined in the schema files. Every table in the schema must be
covered regardless of whether it is referenced in the application's source code.
The schema is the authoritative source; the codebase is supplementary.

SCHEMA/NAMESPACE DETECTION:
If the source database organizes tables into a higher-level grouping structure
(such as SQL Server schemas, Oracle user schemas, PostgreSQL schemas, or MySQL
databases/catalogs), identify these groupings and include a **Schema Overview**
section at the top of the discovery report. Present it as a table with columns
"Schema" and "Tables", listing each schema/namespace and its contained tables.
Organize the access patterns section by these schema groupings when present.
If no such structure is detected in the DDL, omit the Schema Overview section.

After you have fully analyzed the schema, use listWorkspaceFiles and readWorkspaceFile
to SYSTEMATICALLY explore the application's source code for ALL database access patterns.
This is NOT optional — you MUST search the codebase thoroughly before generating the report.${
                        this.props.language
                            ? `

PROJECT CONTEXT:
- Language: ${this.props.language}${this.props.frameworks.length > 0 ? `\n- Frameworks: ${this.props.frameworks.join(', ')}` : ''}${this.props.databaseAccess ? `\n- Database access: ${this.props.databaseAccess}` : ''}

Use this information to narrow your file searches. For example, filter by the project's
file extension (e.g., "**/*.cs" for C#, "**/*.java" for Java, "**/*.ts" for TypeScript,
"**/*.py" for Python) and search for framework-specific patterns
(e.g., DbContext/DbSet for Entity Framework, @Entity/@Repository for Spring/Hibernate,
Sequelize.define for Sequelize, models.Model for Django).`
                            : ''
                    }

CODE EXPLORATION STRATEGY (follow this order):
1. Start with broad searches to discover the project structure:
   - Search for data-layer files: "**/*Repository*", "**/*Service*", "**/*Dal*",
     "**/*Context*", "**/*Model*"${this.props.language ? `, and files matching the project language extension` : ''}
   - Search for ORM/framework-specific patterns based on the project context
2. Read ALL discovered data-layer files to extract database access code.
3. For EACH table/entity found in the schema that still has no code references,
   search specifically for that table name (e.g., "**/*OrderItem*", "**/*Product*").
4. Read any additional files found in step 3.
5. Only after you have exhausted your searches should you generate the final report.

Do NOT stop searching after finding references for just a few tables — continue until
you have searched for ALL tables from the schema. The more code references you find,
the better the migration assessment will be.

Look for database access code such as:
- SQL queries (raw SQL strings, query builders)
- ORM mappings and entity definitions (Entity Framework, Hibernate, Sequelize, etc.)
- Repository or data access layer classes
- Stored procedure calls
- API endpoints that read/write data

Use code references to enrich and validate schema-derived access patterns, but do NOT
skip or omit any schema entity simply because no matching code was found.

Only AFTER you have completed the systematic code exploration above, generate a
comprehensive Markdown document describing the access patterns.

Analyze the schema to infer:
- CRUD operations for each table/entity
- Join patterns and relationship traversals based on foreign keys
- Common query patterns based on indexes and constraints
- Transaction boundaries based on related tables
- ORM details that indicate how the application interacts with the database (when found in code)

For each access pattern, include:
- **Pattern name**
- A Table with (title/content):
  - **Description** (what the application does with this query, keep short)
  - **Estimated frequency** (high/medium/low)
  - **Query type** (read/write/read-write)
  - **Tables/entities involved**
  - **Mapped code references** (list only the files you found that reference these tables, or "None found" if no references exist in the codebase)
- **Example SQL query**
- **List LINQ/EF/HQL,KPQL,Hibernate,JANGO,SQLAlchemy access patterns from code** -
  (summarize similar examples into a single pattern with multiple code snippets,
  or state "No code references found" if the pattern is purely schema-derived)

IMPORTANT: Do NOT omit schema tables or relationships just because the application
code does not reference them. Every entity in the schema must appear in at least one
access pattern. When no code references exist, infer typical access patterns from the
schema structure (foreign keys, indexes, constraints) and note that no code references
were found.

Generate the access patterns as a well-structured Markdown document.
When listing code references, only include files that you have confirmed reference the relevant tables/entities.
Do NOT include files that you have not read or that do not contain relevant references.
When listing code references, create relative Markdown links to the actual files.
The discovery report will be saved at \`${this.props.outputRelativePath}\` relative to the
workspace root, so compute link paths relative to that file's location.
Do NOT wrap the final document in a code block — output it as raw Markdown.
Do NOT include an explanation of your process,
output ONLY the discovery report Markdown document as your final response.`,
                ),
            ),
        );
    }
}
