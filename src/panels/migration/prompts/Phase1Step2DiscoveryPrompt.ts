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
 *
 * File content is NOT embedded in the prompt — the model discovers and reads
 * files via tools (`listSchemaFiles`, `readSchemaFile`, `readAccessPatternFile`,
 * etc.) and uses `copilot_searchCodebase` /
 * `copilot_findTextInFiles` for code exploration.
 */
interface Phase1Step2DiscoveryPromptProps extends BasePromptElementProps {
    /** Whether user-provided access-pattern files exist (beyond access-patterns.md). */
    hasAccessPatternFiles: boolean;
    /** Whether access-patterns.md specifically exists. */
    hasAccessPatternsMd: boolean;
    /** Pre-read content of volumetrics.md, if it exists. */
    volumetricsMdContent?: string;
    /** Table names that have confirmed code evidence in access-patterns.md. */
    codeEvidencedTables?: string[];
    outputRelativePath: string;
    language: string;
    frameworks: string[];
    databaseType: string;
    databaseAccess: string;
    discoveryInstructions: string;
}

/**
 * Prompt element for the discovery report generation step.
 *
 * This is an instruction-only prompt used in the agentic tool-calling loop.
 * No file content is embedded — the model uses its available tools to discover
 * and read schema files, access patterns, volumetric data, and source code.
 * For code exploration, it prefers `copilot_searchCodebase` and
 * `copilot_findTextInFiles` before falling back to workspace file tools.
 */
export class Phase1Step2DiscoveryPrompt extends PromptElement<Phase1Step2DiscoveryPromptProps> {
    render(_state: void, _sizing: PromptSizing): PromptPiece {
        const hasCodeEvidencedTables = this.props.codeEvidencedTables && this.props.codeEvidencedTables.length > 0;
        const codeEvidencedList = hasCodeEvidencedTables ? this.props.codeEvidencedTables! : [];

        // ── Schema data instructions ──
        const schemaInstructions = `SCHEMA DATA:
Use listSchemaFiles to discover all available schema files, then readSchemaFile to
read each one. Review ALL schema files before proceeding to code exploration.`;

        // ── Access-pattern instructions ──
        let accessPatternInstructions = '';
        if (this.props.hasAccessPatternsMd) {
            accessPatternInstructions = `\n\nACCESS PATTERN DATA:
A user-curated "access-patterns.md" file exists. Use readAccessPatternFile to read it
BEFORE exploring the codebase — it contains known access patterns that should be
incorporated into your analysis.
Patterns that include markdown file links in the Notes column are treated as code-evidenced
and authoritative — accept these as-is without re-verifying the linked files.
When generating the final report, place these patterns under the "### Code-Evidenced"
subsection and set their Evidence field to \`code\`.
Patterns WITHOUT file links are unverified and may need workspace exploration
to confirm or enrich.
IMPORTANT: Include ALL code-evidenced patterns (those with file links) in the final report,
even if their schema namespace (e.g., SalesLT, dbo) does not appear in the schema DDL files
or the Schema Overview. Do NOT exclude code-evidenced patterns based on schema-scope or
namespace reasoning — they represent confirmed application behavior and MUST always appear
in the Code-Evidenced section.`;
            if (codeEvidencedList.length > 0) {
                accessPatternInstructions += `\n\nCODE-EVIDENCED TABLES (do NOT explore workspace for these):
The following tables/entities have confirmed code evidence from access-patterns.md.
Do NOT use copilot_searchCodebase, copilot_findTextInFiles, listWorkspaceFiles, or
readWorkspaceFile to find references for these tables:
${codeEvidencedList.join(', ')}`;
            }
            if (this.props.hasAccessPatternFiles) {
                accessPatternInstructions += `\n\nAdditional access pattern files (beyond access-patterns.md) are available via
listAccessPatternFiles and readAccessPatternFile if you need supplementary context.`;
            }
        } else if (this.props.hasAccessPatternFiles) {
            accessPatternInstructions = `\n\nACCESS PATTERN DATA:
User-provided access pattern files are available. Use listAccessPatternFiles to discover
them, then readAccessPatternFile to read them. These contain known access patterns that
should be incorporated into your analysis.`;
        }

        // ── Volumetric data instructions ──
        const volumetricInstructions = this.props.volumetricsMdContent
            ? `\n\nVOLUMETRIC DATA:
Volumetric data from "volumetrics.md" is provided below. Treat it as the SOLE
authoritative source for TPS estimates. Every TPS estimate MUST be derived from
this data when available.`
            : '';

        // ── Code exploration strategy ──
        const codeExplorationStrategy = `CODE EXPLORATION STRATEGY:
${
    hasCodeEvidencedTables
        ? `Some tables already have confirmed code evidence from access-patterns.md.
Search the codebase ONLY for tables/entities that LACK code evidence — i.e., tables
NOT listed in the "CODE-EVIDENCED TABLES" section above.

For the remaining tables without code evidence:`
        : `After you have fully analyzed the schema, SYSTEMATICALLY explore the application's
source code for ALL database access patterns. This is NOT optional — you MUST search
the codebase thoroughly before generating the report.`
}

1. **Use copilot_searchCodebase FIRST** — for each table/entity from the schema, run
   focused natural-language queries (e.g., "database queries for Orders table",
   "repository pattern for Products", "CRUD operations for Customers").
   Use glob patterns to scope searches (e.g., \`src/**/*.cs\`, \`**/*Repository*\`).
   Always exclude the migration configuration folder: use \`**/.cosmosdb-migration/**\` as an exclude glob.
2. **Use copilot_findTextInFiles** for exact matches — search for table names,
   entity names, or schema-qualified names (e.g., "dbo.Orders", "OrderItems")
   to find references the semantic search may have missed.
   Always exclude \`**/.cosmosdb-migration/**\` from search results.
3. **Fall back to listWorkspaceFiles + readWorkspaceFile** only when the copilot
   tools do not surface enough evidence for a given table/entity. Use targeted
   glob patterns (e.g., "**/*Order*", "**/*Repository*") rather than broad scans.
4. Only after you have exhausted your searches should you generate the final report.${
            !hasCodeEvidencedTables
                ? `

Do NOT stop searching after finding references for just a few tables — continue until
you have searched for ALL tables from the schema.`
                : ''
        }`;

        // ── Volumetric data element (embedded when available) ──
        const volumetricDataMessage = this.props.volumetricsMdContent
            ? vscpp(
                  UserMessage,
                  { priority: 80 },
                  vscpp(TextChunk, { priority: 83 }, `VOLUMETRIC DATA (from volumetrics.md):\n\n`),
                  vscpp(TextChunk, { priority: 80, breakOn: /\s+/g }, this.props.volumetricsMdContent),
              )
            : null;

        return vscpp(
            vscppf,
            null,
            vscpp(
                UserMessage,
                { priority: 200 },
                `You are a database migration assistant specializing in migrating relational databases to Azure Cosmos DB NoSQL.

You have access to tools that let you discover and read the project's database schema
files, access-pattern documentation, and application source code.
Use these tools to gather all necessary information before generating the report.

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

PROJECT CONTEXT (if a field says "Unknown", infer it from the schema files and codebase):
- Language: ${this.props.language || 'Unknown'}
${this.props.frameworks.length > 0 ? `- Frameworks: ${this.props.frameworks.join(', ')}\n` : ''}\
- Source database: ${this.props.databaseType || 'Unknown'}
${this.props.databaseAccess ? `- Database access: ${this.props.databaseAccess}\n` : ''}\

Use this information to narrow your searches. For example, filter by the project's
file extension (e.g., "**/*.cs" for C#, "**/*.java" for Java, "**/*.ts" for TypeScript,
"**/*.py" for Python) and search for framework-specific patterns
(e.g., DbContext/DbSet for Entity Framework, @Entity/@Repository for Spring/Hibernate,
Sequelize.define for Sequelize, models.Model for Django).

${schemaInstructions}${accessPatternInstructions}${volumetricInstructions}

${codeExplorationStrategy}

Look for database access code such as:
- Queries (raw query strings, query builders, dialect-specific syntax like T-SQL, PL/SQL, PL/pgSQL)
- ORM mappings and entity definitions (Entity Framework, Hibernate, Sequelize, Django ORM, SQLAlchemy, etc.)
- Repository or data access layer classes
- Stored procedures, functions, and triggers
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

ACCESS PATTERN ID CONVENTION:
Each access pattern MUST have a deterministic unique ID as its heading, formatted as:
  \`<prefix><NNN>-<ShortName>\`
where:
- **prefix** is \`R\` for read patterns or \`W\` for write patterns.
- **NNN** is a zero-padded 3-digit sequential number, starting at 001 within each
  prefix (R001, R002, … and W001, W002, …).
- **ShortName** is a concise PascalCase label derived from the primary table and
  operation (e.g., \`GetOrdersByCustomer\`, \`InsertLineItem\`, \`UpdateInventoryStock\`).

Examples: \`R001-GetOrdersByCustomer\`, \`W001-InsertOrder\`, \`R002-ListProductsByCatalog\`.

REPORT STRUCTURE — SPLIT BY READ / WRITE:
Organize the access patterns into two top-level sections:

  ## Read Patterns
  (all patterns with prefix R)

  ## Write Patterns
  (all patterns with prefix W)

Within EACH section, order patterns as follows:
1. **Code-evidenced patterns** — patterns that have at least one confirmed code
   reference in the codebase. Sort by estimated TPS descending.
2. **Schema-inferred patterns** — patterns derived purely from schema structure
   (foreign keys, indexes, constraints) or raw queries with no matching application
   code found. Sort by estimated TPS descending.

Separate the two groups with a horizontal rule (\`---\`) and a brief sub-heading
(e.g., "### Code-Evidenced" / "### Schema-Inferred").

For each access pattern, include:
- **Pattern ID** as the heading (e.g., \`### R001-GetOrdersByCustomer\`)
- A Table with (title/content):
  - **Description** (what the application does with this query, keep short)
  - **Estimated TPS** — an integer estimate of transactions per second for this
    pattern. When volumetric data is available, derive TPS from the provided
    query logs, AWR reports, or usage statistics. When no volumetric data is
    available, estimate a reasonable TPS based on typical workload assumptions
    and state "(estimated)" next to the number.
  - **Tables/Entities involved**
  - **Filter/Lookup Fields** for Read operations (the columns commonly used in WHERE clauses or query filters)
  - **Single/Batch** for Write operations — indicate whether the operation writes a single record or multiple records in one operation (e.g., "Single", "Batch")
  - **Evidence** — one of: \`code\`, \`schema-inferred\`, or \`query-only\`
  - **Mapped code references** (list only the files you found that reference these tables, or "None found" if no references exist in the codebase)
- **Example query** (in the source database's dialect)
- **ORM / data-access code patterns** — list relevant code snippets from the codebase
  (e.g., LINQ, EF DbSet calls, Hibernate HQL/JPQL, Django ORM, SQLAlchemy, Sequelize,
  raw query strings). Summarize similar examples into a single pattern with multiple
  code snippets, or state "No code references found" if the pattern is purely schema-derived.

IMPORTANT: Do NOT omit schema tables or relationships just because the application
code does not reference them. Every entity in the schema must appear in at least one
access pattern. When no code references exist, infer typical access patterns from the
schema structure (foreign keys, indexes, constraints) and mark them as \`schema-inferred\`.

Generate the access patterns as a well-structured Markdown document.
When listing code references, only include files that you have confirmed reference the relevant tables/entities.
Do NOT include files that you have not read or that do not contain relevant references.
When listing code references, create relative Markdown links to the actual files.
The discovery report will be saved at \`${this.props.outputRelativePath}\` relative to the
workspace root, so compute link paths relative to that file's location.
Do NOT wrap the final document in a code block — output it as raw Markdown.${
                    this.props.discoveryInstructions
                        ? `

ADDITIONAL DISCOVERY INSTRUCTIONS (from the user):
${this.props.discoveryInstructions}
`
                        : ''
                }
Do NOT include an explanation of your process,
output ONLY the discovery report Markdown document as your final response.
Your response MUST begin with a Markdown heading (\`#\`). Do not include any preamble,
thinking, or commentary before the heading.`,
            ),
            ...(volumetricDataMessage ? [volumetricDataMessage] : []),
        );
    }
}
