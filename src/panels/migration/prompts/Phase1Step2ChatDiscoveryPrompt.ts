/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Chat-based alternative to {@link Phase1Step2DiscoveryPrompt}.
 *
 * Instead of rendering a `@vscode/prompt-tsx` element for a raw LLM agentic
 * loop, this module builds a plain-text prompt string that is dispatched to
 * Copilot Chat via `workbench.action.chat.open`. All input files are provided
 * as `#file:` links that Chat resolves natively, eliminating the need for
 * custom list/read tools. Chat's built-in workspace tools handle code
 * exploration the same way the agentic loop's workspace tools did.
 *
 * Toggle between the two paths with the `USE_CHAT_DISCOVERY` constant in
 * `phase1Discovery.ts`.
 */

/**
 * Options for building the Chat-based discovery prompt.
 */
export interface ChatDiscoveryPromptOptions {
    /** Workspace-relative paths to schema files (DDL / CSV). */
    schemaFileRefs: string[];
    /** Workspace-relative path to access-patterns.md, if it exists. */
    accessPatternsMdPath?: string;
    /** Workspace-relative paths to other access-pattern files (beyond access-patterns.md). */
    accessPatternFileRefs?: string[];
    /** Workspace-relative path to volumetrics.md, if it exists. */
    volumetricsMdPath?: string;
    /** Workspace-relative paths to other volumetric files (beyond volumetrics.md). */
    volumetricFileRefs?: string[];
    /** Table names that have confirmed code evidence in access-patterns.md. */
    codeEvidencedTables?: string[];
    /** Workspace-relative output path where the report should be saved. */
    outputRelativePath: string;
    language: string;
    frameworks: string[];
    databaseType: string;
    databaseAccess: string;
    discoveryInstructions?: string;
}

/**
 * Builds a Copilot Chat prompt for discovery report generation.
 *
 * The returned string should be dispatched via:
 * ```ts
 * vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt });
 * ```
 *
 * The prompt mirrors the core instructions of {@link Phase1Step2DiscoveryPrompt}
 * but references all input files as `#file:` links instead of embedding content
 * and relying on custom tool calls.
 */
export function buildChatDiscoveryPrompt(options: ChatDiscoveryPromptOptions): string {
    const {
        schemaFileRefs,
        accessPatternsMdPath,
        accessPatternFileRefs,
        volumetricsMdPath,
        volumetricFileRefs,
        codeEvidencedTables,
        outputRelativePath,
        language,
        frameworks,
        databaseType,
        databaseAccess,
        discoveryInstructions,
    } = options;

    const lines: string[] = [];

    // ── Role & file references ──────────────────────────────────────
    lines.push(
        'You are a database migration assistant specializing in migrating relational databases to Azure Cosmos DB NoSQL.',
        '',
        'The following schema files define the source database structure — read them all before proceeding:',
        ...schemaFileRefs.map((f) => `#file:${f}`),
    );

    // ── Access-patterns.md ──────────────────────────────────────────
    if (accessPatternsMdPath) {
        lines.push(
            '',
            'Known access patterns have been provided in the following file:',
            `#file:${accessPatternsMdPath}`,
        );
    }

    if (accessPatternFileRefs && accessPatternFileRefs.length > 0) {
        lines.push(
            '',
            'Additional access-pattern files are available for supplementary context:',
            ...accessPatternFileRefs.map((f) => `#file:${f}`),
        );
    }

    // ── Volumetrics ─────────────────────────────────────────────────
    if (volumetricsMdPath) {
        lines.push(
            '',
            'Volumetric data is available — use it as the PRIMARY authoritative source for TPS estimates:',
            `#file:${volumetricsMdPath}`,
            'Every TPS estimate MUST be derived from this data when available.',
        );

        if (volumetricFileRefs && volumetricFileRefs.length > 0) {
            lines.push(
                '',
                'Additional volumetric source files are listed below for supplementary data.',
                'These may be large (AWR reports, query logs); consider their size and token cost',
                'before reading them. Use them only to supplement the curated volumetrics.md above:',
                ...volumetricFileRefs.map((f) => `#file:${f}`),
            );
        }
    } else if (volumetricFileRefs && volumetricFileRefs.length > 0) {
        lines.push(
            '',
            'No curated volumetrics.md was provided, but the following volumetric data files are available.',
            'Use this data to ground your TPS (transactions per second) estimates for each access pattern.',
            'These files may be large (AWR reports, query logs); consider their size and token cost:',
            ...volumetricFileRefs.map((f) => `#file:${f}`),
        );
    }

    // ── Core instructions ───────────────────────────────────────────
    lines.push(
        '',
        'Instructions:',
        '',
        'IMPORTANT — SCHEMA-FIRST APPROACH:',
        'Your primary goal is to produce access patterns for ALL tables, entities, and',
        'relationships defined in the schema files. Every table in the schema must be',
        "covered regardless of whether it is referenced in the application's source code.",
        'The schema is the authoritative source; the codebase is supplementary.',
        '',
        'SCHEMA/NAMESPACE DETECTION:',
        'If the source database organizes tables into a higher-level grouping structure',
        '(such as SQL Server schemas, Oracle user schemas, PostgreSQL schemas, or MySQL',
        'databases/catalogs), identify these groupings and include a **Schema Overview**',
        'section at the top of the discovery report. Present it as a table with columns',
        '"Schema" and "Tables", listing each schema/namespace and its contained tables.',
        'Organize the access patterns section by these schema groupings when present.',
        'If no such structure is detected in the DDL, omit the Schema Overview section.',
    );

    // ── Project context ─────────────────────────────────────────────
    lines.push(
        '',
        'PROJECT CONTEXT (if a field says "Unknown", infer it from the schema files and codebase):',
        `- Language: ${language || 'Unknown'}`,
    );
    if (frameworks.length > 0) {
        lines.push(`- Frameworks: ${frameworks.join(', ')}`);
    }
    lines.push(`- Source database: ${databaseType || 'Unknown'}`);
    if (databaseAccess) {
        lines.push(`- Database access: ${databaseAccess}`);
    }
    lines.push(
        '',
        "Use this information to narrow your file searches. For example, filter by the project's",
        'file extension (e.g., "**/*.cs" for C#, "**/*.java" for Java, "**/*.ts" for TypeScript,',
        '"**/*.py" for Python) and search for framework-specific patterns',
        '(e.g., DbContext/DbSet for Entity Framework, @Entity/@Repository for Spring/Hibernate,',
        'Sequelize.define for Sequelize, models.Model for Django).',
    );

    // ── Code exploration strategy ───────────────────────────────────
    const hasCodeEvidenced = codeEvidencedTables && codeEvidencedTables.length > 0;

    lines.push('', 'CODE EXPLORATION STRATEGY (follow this order):');

    if (hasCodeEvidenced) {
        lines.push(
            'Some tables already have confirmed code evidence from access-patterns.md.',
            'Search the workspace ONLY for tables/entities that LACK code evidence — i.e.,',
            'tables NOT listed in the "CODE-EVIDENCED TABLES" section below.',
            'Do NOT re-scan the workspace for tables that already have confirmed code references.',
            '',
            'For the remaining tables without code evidence:',
        );
    } else {
        lines.push(
            'After you have fully analyzed the schema, SYSTEMATICALLY explore the',
            "application's source code for ALL database access patterns.",
            'This is NOT optional — you MUST search the codebase thoroughly before generating the report.',
        );
    }

    lines.push(
        '',
        '1. Start with broad searches to discover the project structure:',
        '   - Search for data-layer files: "**/*Repository*", "**/*Service*", "**/*Dal*",',
        `     "**/*Context*", "**/*Model*"${language ? ', and files matching the project language extension' : ''}`,
        '   - Search for ORM/framework-specific patterns based on the project context',
        '2. Read ALL discovered data-layer files to extract database access code.',
        '3. For EACH table/entity from the schema that still has no code references,',
        '   search specifically for that table name (e.g., "**/*OrderItem*", "**/*Product*").',
        '4. Read any additional files found in step 3.',
        '5. Only after you have exhausted your searches should you generate the final report.',
    );

    if (!hasCodeEvidenced) {
        lines.push(
            '',
            'Do NOT stop searching after finding references for just a few tables — continue until',
            'you have searched for ALL tables from the schema. The more code references you find,',
            'the better the migration assessment will be.',
        );
    }

    // ── Known access patterns handling ──────────────────────────────
    if (accessPatternsMdPath) {
        lines.push(
            '',
            'KNOWN ACCESS PATTERNS:',
            'The access patterns provided in access-patterns.md are supplementary context.',
            'Patterns that include markdown file links in the Notes column are treated as code-evidenced and',
            'authoritative — accept these as-is without re-verifying the linked files.',
            'When generating the final report, place these patterns under the "### Code-Evidenced"',
            'subsection and set their Evidence field to `code`.',
            'Patterns WITHOUT file links are unverified and may need workspace exploration',
            'to confirm or enrich.',
            'IMPORTANT: Include ALL code-evidenced patterns (those with file links) in the final report,',
            'even if their schema namespace (e.g., SalesLT, dbo) does not appear in the schema DDL files',
            'or the Schema Overview. Do NOT exclude code-evidenced patterns based on schema-scope or',
            'namespace reasoning — they represent confirmed application behavior and MUST always appear',
            'in the Code-Evidenced section.',
        );

        if (hasCodeEvidenced) {
            lines.push(
                '',
                'CODE-EVIDENCED TABLES (do NOT explore workspace for these):',
                'The following tables/entities have confirmed code evidence from access-patterns.md.',
                'Do NOT search the workspace to find references for these tables:',
                codeEvidencedTables.join(', '),
            );
        }
    }

    // ── What to look for ────────────────────────────────────────────
    lines.push(
        '',
        'Look for database access code such as:',
        '- Queries (raw query strings, query builders, dialect-specific syntax like T-SQL, PL/SQL, PL/pgSQL)',
        '- ORM mappings and entity definitions (Entity Framework, Hibernate, Sequelize, Django ORM, SQLAlchemy, etc.)',
        '- Repository or data access layer classes',
        '- Stored procedures, functions, and triggers',
        '- API endpoints that read/write data',
        '',
        'Use code references to enrich and validate schema-derived access patterns, but do NOT',
        'skip or omit any schema entity simply because no matching code was found.',
    );

    // ── Analysis instructions ───────────────────────────────────────
    lines.push(
        '',
        'Only AFTER you have completed the systematic code exploration above, generate a',
        'comprehensive Markdown document describing the access patterns.',
        '',
        'Analyze the schema to infer:',
        '- CRUD operations for each table/entity',
        '- Join patterns and relationship traversals based on foreign keys',
        '- Common query patterns based on indexes and constraints',
        '- Transaction boundaries based on related tables',
        '- ORM details that indicate how the application interacts with the database (when found in code)',
    );

    // ── Access pattern ID convention ────────────────────────────────
    lines.push(
        '',
        'ACCESS PATTERN ID CONVENTION:',
        'Each access pattern MUST have a deterministic unique ID as its heading, formatted as:',
        '  `<prefix><NNN>-<ShortName>`',
        'where:',
        '- **prefix** is `R` for read patterns or `W` for write patterns.',
        '- **NNN** is a zero-padded 3-digit sequential number, starting at 001 within each',
        '  prefix (R001, R002, … and W001, W002, …).',
        '- **ShortName** is a concise PascalCase label derived from the primary table and',
        '  operation (e.g., `GetOrdersByCustomer`, `InsertLineItem`, `UpdateInventoryStock`).',
        '',
        'Examples: `R001-GetOrdersByCustomer`, `W001-InsertOrder`, `R002-ListProductsByCatalog`.',
    );

    // ── Report structure ────────────────────────────────────────────
    lines.push(
        '',
        'REPORT STRUCTURE — SPLIT BY READ / WRITE:',
        'Organize the access patterns into two top-level sections:',
        '',
        '  ## Read Patterns',
        '  (all patterns with prefix R)',
        '',
        '  ## Write Patterns',
        '  (all patterns with prefix W)',
        '',
        'Within EACH section, order patterns as follows:',
        '1. **Code-evidenced patterns** — patterns that have at least one confirmed code',
        '   reference in the codebase. Sort by estimated TPS descending.',
        '2. **Schema-inferred patterns** — patterns derived purely from schema structure',
        '   (foreign keys, indexes, constraints) or raw queries with no matching application',
        '   code found. Sort by estimated TPS descending.',
        '',
        'Separate the two groups with a horizontal rule (`---`) and a brief sub-heading',
        '(e.g., "### Code-Evidenced" / "### Schema-Inferred").',
    );

    // ── Per-pattern detail ──────────────────────────────────────────
    lines.push(
        '',
        'For each access pattern, include:',
        '- **Pattern ID** as the heading (e.g., `### R001-GetOrdersByCustomer`)',
        '- A Table with (title/content):',
        '  - **Description** (what the application does with this query, keep short)',
        '  - **Estimated TPS** — an integer estimate of transactions per second for this',
        '    pattern. When volumetric data is available, derive TPS from the provided',
        '    query logs, AWR reports, or usage statistics. When no volumetric data is',
        '    available, estimate a reasonable TPS based on typical workload assumptions',
        '    and state "(estimated)" next to the number.',
        '  - **Tables/Entities involved**',
        '  - **Filter/Lookup Fields** for Read operations (the columns commonly used in WHERE clauses or query filters)',
        '  - **Single/Batch** for Write operations — indicate whether the operation writes a single record or multiple records in one operation (e.g., "Single", "Batch")',
        '  - **Evidence** — one of: `code`, `schema-inferred`, or `query-only`',
        '  - **Mapped code references** (list only the files you found that reference these tables, or "None found" if no references exist in the codebase)',
        "- **Example query** (in the source database's dialect)",
        '- **ORM / data-access code patterns** — list relevant code snippets from the codebase',
        '  (e.g., LINQ, EF DbSet calls, Hibernate HQL/JPQL, Django ORM, SQLAlchemy, Sequelize,',
        '  raw query strings). Summarize similar examples into a single pattern with multiple',
        '  code snippets, or state "No code references found" if the pattern is purely schema-derived.',
    );

    // ── Completeness & output instructions ──────────────────────────
    lines.push(
        '',
        'IMPORTANT: Do NOT omit schema tables or relationships just because the application',
        'code does not reference them. Every entity in the schema must appear in at least one',
        'access pattern. When no code references exist, infer typical access patterns from the',
        'schema structure (foreign keys, indexes, constraints) and mark them as `schema-inferred`.',
        '',
        'Generate the access patterns as a well-structured Markdown document.',
        'When listing code references, only include files that you have confirmed reference the relevant tables/entities.',
        'Do NOT include files that you have not read or that do not contain relevant references.',
        'When listing code references, create relative Markdown links to the actual files.',
        `The discovery report will be saved at \`${outputRelativePath}\` relative to the`,
        "workspace root, so compute link paths relative to that file's location.",
        'Do NOT wrap the final document in a code block — output it as raw Markdown.',
    );

    // ── Additional user instructions ────────────────────────────────
    if (discoveryInstructions) {
        lines.push('', 'ADDITIONAL DISCOVERY INSTRUCTIONS (from the user):', discoveryInstructions);
    }

    // ── Output destination ──────────────────────────────────────────
    lines.push(
        '',
        `Save the final discovery report to \`${outputRelativePath}\` (workspace-relative path).`,
        'Create the file using your available file creation tools.',
        '',
        'Do NOT include an explanation of your process,',
        'output ONLY the discovery report Markdown document as your final response.',
        'Your response MUST begin with a Markdown heading (`#`). Do not include any preamble,',
        'thinking, or commentary before the heading.',
    );

    return lines.join('\n');
}
