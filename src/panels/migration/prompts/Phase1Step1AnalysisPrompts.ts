/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

/**
 * Builds a Copilot Chat prompt that instructs the AI to read the selected
 * volumetric data files and fill in the volumetrics.md template.
 *
 * @param sourceRefs - A folder path (string) or individual file paths (string[]), workspace-relative.
 * @param templateRelativePath - Workspace-relative path to the template file.
 * @param schemaFileRefs - A folder path (string) or individual file paths (string[]), workspace-relative.
 * @param discoveryInstructions - Optional custom discovery instructions for the AI.
 */
export function buildAnalyzeVolumetricsPrompt(
    sourceRefs: string | string[],
    templateRelativePath: string,
    schemaFileRefs: string | string[],
    discoveryInstructions?: string,
): string {
    const isFolder = typeof sourceRefs === 'string';
    const sourceRefStr = isFolder ? `#file:${sourceRefs}` : sourceRefs.map((f) => `#file:${f}`).join('\n');

    const isSchemaFolder = typeof schemaFileRefs === 'string';
    const schemaRefStr = isSchemaFolder
        ? `#file:${schemaFileRefs}`
        : schemaFileRefs.map((f) => `#file:${f}`).join('\n');

    const lines: string[] = [
        `Analyze the following volumetric data files and use the results to fill in the template at #file:${templateRelativePath}.`,
        '',
        'Source files to analyze:',
        sourceRefStr,
    ];

    if (isFolder && path.dirname(templateRelativePath) === sourceRefs) {
        lines.push(
            `- The template file (${path.basename(templateRelativePath)}) is inside the source folder — do NOT treat it as source data.`,
        );
    }

    lines.push(
        '',
        'The following schema files are also available — use them to cross-reference table names and structure:',
        schemaRefStr,
        '- Use the schema to understand the shape of the data. If the source data contains timestamp columns or other temporal fields, use them to infer growth rates, traffic patterns, and historical trends.',
    );

    lines.push(
        '',
        'Instructions:',
        '- Read each source file and extract volumetric data (table names, row counts, row sizes, read/write TPS, growth rates).',
        '- Replace the example rows in the volumetrics.md template table with real data extracted from the source files.',
        '- Keep the existing table headers and markdown structure intact.',
        '- If a field cannot be determined from the source data, mark it with "N/A" or a reasonable estimate annotated with "(estimated)".',
        '- After filling in the table, inspect the source code and configuration for **information the table cannot capture** and populate the `## Workload Notes (optional)` section accordingly. In particular, look for and add a bullet when you can infer it:',
        '  - **TTL / retention**: TTL config on tables/collections, scheduled purge/archive jobs, or comments indicating data lifetime.',
        '  - **Document size P95 / P99**: presence of large TEXT/BLOB/JSON columns, file references, or sparse wide rows whose 95th-percentile size meaningfully exceeds the average.',
        '  - **Hot partitions / skew**: comments, multi-tenant patterns, or table designs hinting at a small number of high-traffic keys.',
        '  - **Peak vs. average TPS**: scheduled batch jobs, cron triggers, or business notes about peak hours / seasonal spikes.',
        '  - **Read mix / Write mix overrides**: only add these if the production behavior described in the source clearly differs from the access patterns inferable from queries (rare — usually leave blank and let the schema-conversion prompt infer).',
        '  - **Account-level intent**: configured replication regions, consistency level, or explicit capacity-mode choices in deployment scripts.',
        '- Keep these as concise bullets under the existing headings; preserve any bullets the user has already filled in.',
        '- After updating the file, print a short summary of what you added to Workload Notes and ask the user whether anything is missing or should be refined.',
    );

    if (discoveryInstructions) {
        lines.push('', 'Custom discovery instructions:', discoveryInstructions);
    }

    return lines.join('\n');
}

/**
 * Optional project context that helps the AI narrow its workspace searches.
 */
export interface AnalysisProjectContext {
    language?: string;
    frameworks?: string[];
    databaseType?: string;
    databaseAccess?: string;
}

/**
 * Builds a Copilot Chat prompt that instructs the AI to scan the workspace
 * for access patterns and fill in the access-patterns.md template.
 * Any user-provided source files are included as supplementary context.
 *
 * @param sourceRefs - A folder path (string), individual file paths (string[]), or undefined if no source files.
 * @param templateRelativePath - Workspace-relative path to the template file.
 * @param schemaFileRefs - A folder path (string) or individual file paths (string[]), workspace-relative.
 * @param volumetricsTemplatePath - Optional workspace-relative path to the volumetrics template.
 * @param projectContext - Optional language/framework/database hints to help the AI narrow its searches.
 * @param discoveryInstructions - Optional custom discovery instructions for the AI.
 */
export function buildAnalyzeAccessPatternsPrompt(
    sourceRefs: string | string[] | undefined,
    templateRelativePath: string,
    schemaFileRefs: string | string[],
    volumetricsTemplatePath?: string,
    projectContext?: AnalysisProjectContext,
    discoveryInstructions?: string,
): string {
    const lines: string[] = [
        `Analyze the application source code in this workspace to identify database access patterns and fill in the access-patterns template at #file:${templateRelativePath}.`,
    ];

    if (sourceRefs !== undefined) {
        const isFolder = typeof sourceRefs === 'string';
        const sourceRefStr = isFolder ? `#file:${sourceRefs}` : sourceRefs.map((f) => `#file:${f}`).join('\n');
        lines.push(
            '',
            'The following supplementary access-pattern files have also been provided — incorporate their contents:',
            sourceRefStr,
        );

        if (isFolder && path.dirname(templateRelativePath) === sourceRefs) {
            lines.push(
                `- The template file (${path.basename(templateRelativePath)}) is inside the source folder — do NOT treat it as source data.`,
            );
        }
    }

    if (volumetricsTemplatePath) {
        lines.push(
            '',
            'Volumetric data is available — use it to ground your TPS estimates:',
            `#file:${volumetricsTemplatePath}`,
            '- Derive TPS values from the volumetrics data whenever possible instead of guessing.',
        );
    }

    const isSchemaFolder = typeof schemaFileRefs === 'string';
    const schemaRefStr = isSchemaFolder
        ? `#file:${schemaFileRefs}`
        : schemaFileRefs.map((f) => `#file:${f}`).join('\n');
    lines.push(
        '',
        'The following schema files are also available — use them to cross-reference table names and structure:',
        schemaRefStr,
    );

    // Inject project context when available so the AI can narrow its searches
    if (projectContext) {
        const { language, frameworks, databaseType, databaseAccess } = projectContext;
        const hasContext = language || (frameworks && frameworks.length > 0) || databaseType || databaseAccess;
        if (hasContext) {
            lines.push('', 'Project context (if a field says "Unknown", infer it from the schema files and codebase):');
            lines.push(`- Language: ${language || 'Unknown'}`);
            if (frameworks && frameworks.length > 0) {
                lines.push(`- Frameworks: ${frameworks.join(', ')}`);
            }
            lines.push(`- Source database: ${databaseType || 'Unknown'}`);
            if (databaseAccess) {
                lines.push(`- Database access: ${databaseAccess}`);
            }
            lines.push(
                '',
                "Use this information to narrow your file searches (e.g., filter by the project's file extension and search for framework-specific patterns).",
            );
        }
    }

    lines.push(
        '',
        'Instructions:',
        '',
        'SCHEMA-FIRST — Every table/entity defined in the schema files MUST appear in at least one access pattern.',
        'When no code references exist for a schema entity, infer typical CRUD patterns from its foreign keys, indexes, and constraints.',
        'Mark such inferred patterns with "(schema-inferred)" in the Notes column.',
        '',
        '- Scan the workspace for database queries (raw SQL, query builders), ORM mappings and entity definitions, repository or data-access-layer classes, stored procedures and triggers, and API endpoints that read/write data.',
        '- Identify read and write access patterns (queries, lookups, inserts, updates, deletes).',
        '- Replace the example rows in the access-patterns.md template tables with real patterns extracted from the codebase.',
        '- Keep the existing table headers and markdown structure (Read Patterns / Write Patterns sections) intact.',
        '- Assign pattern IDs using the format R### for reads and W### for writes (e.g., R001, W001). Each pattern must have a unique combination of # (ID) and Pattern Name — do not reuse pattern names across rows.',
        '- When volumetric data is provided, use its TPS figures to fill in Frequency (TPS) for each pattern. When no volumetric data covers a pattern, provide a reasonable estimate and mark it with "(estimated)".',
        '- Set Latency Requirement based on the nature of the operation (e.g., point reads are more latency-sensitive than batch jobs).',
        '- Use code references to enrich and validate schema-derived patterns, but do NOT skip or omit any schema entity simply because no matching code was found.',
        // TODO: Once the discovery prompt can be offloaded to the Chat API (which resolves #file references natively) instead of a raw LLM call, replace the plain-text file paths below with #file: references so the model can navigate to them directly.
        `- The access-patterns template is located at \`${templateRelativePath}\` relative to the workspace root. When adding Markdown links to source files, compute the link path relative to the template file's directory so the links resolve correctly when the file is opened.`,
        '- For every pattern discovered in code (not schema-inferred), include evidence in the Notes column: add a line break (`<br>`) followed by a relative Markdown link to the source file with a line-number anchor (`#L{lineNumber}`), and if possible, the function or method name (e.g., `<br>Source: [OrderRepo.ts](../../src/repositories/OrderRepo.ts#L42) — getOrderById()`). The `#L` suffix lets Copilot and VS Code open the file at the exact line. This helps reviewers locate the original code.',
        '- If the schema organizes tables into schemas or namespaces (e.g., SQL Server schemas, PostgreSQL schemas), note the groupings in the Additional Notes section.',
        '- Add any relevant notes about batch operations, reporting queries, or cross-entity joins in the Additional Notes section.',
    );

    if (discoveryInstructions) {
        lines.push('', 'Custom discovery instructions:', discoveryInstructions);
    }

    return lines.join('\n');
}

/**
 * Builds a Copilot Chat prompt that instructs the AI to scan the workspace
 * for database entities and generate consolidated DDL schema files grouped
 * by domain. Optionally fills in the access-patterns template as a side task
 * when it is still empty (template-only) so the schema and patterns stay in sync.
 *
 * @param schemaFolderRelativePath - Workspace-relative path to the schema-ddl folder where output files should be written.
 * @param existingSchemaFiles - Workspace-relative paths to existing schema files already in the folder (empty array if none).
 * @param accessPatternsTemplatePath - Workspace-relative path to the access-patterns.md template file (always provided; created beforehand if missing).
 * @param projectContext - Optional language/framework/database hints to help the AI narrow its searches.
 * @param discoveryInstructions - Optional custom discovery instructions for the AI.
 */
export function buildAnalyzeDatabaseSchemaPrompt(
    schemaFolderRelativePath: string,
    existingSchemaFiles: string[],
    accessPatternsTemplatePath: string,
    projectContext?: AnalysisProjectContext,
    discoveryInstructions?: string,
): string {
    const lines: string[] = [
        `Analyze the application source code in this workspace to reverse-engineer the database schema, then write one consolidated DDL file per domain into the folder \`${schemaFolderRelativePath}\`.`,
    ];

    if (existingSchemaFiles.length > 0) {
        lines.push(
            '',
            'The following schema files already exist in the target folder — treat them as ground truth and extend rather than replace:',
            existingSchemaFiles.map((f) => `#file:${f}`).join('\n'),
            '',
            'Before writing anything, propose options to the user and ask which to take:',
            '  1. Extend the existing files in place (add missing tables, leave existing ones untouched).',
            `  2. Write the new files into a \`${schemaFolderRelativePath}/generated/\` subfolder so nothing is overwritten.`,
            '  3. Abort and let the user clean up manually.',
            '  4. Anything else — let the user describe how they would like to proceed in their own words, and follow their instructions.',
            'Do not write any schema files until the user has chosen an option.',
        );
    } else {
        lines.push(
            '',
            `The target folder \`${schemaFolderRelativePath}\` is currently empty — write the generated files directly into it.`,
        );
    }

    // Inject project context when available so the AI can narrow its searches
    if (projectContext) {
        const { language, frameworks, databaseType, databaseAccess } = projectContext;
        const hasContext = language || (frameworks && frameworks.length > 0) || databaseType || databaseAccess;
        if (hasContext) {
            lines.push('', 'Project context (if a field says "Unknown", infer it from the codebase):');
            lines.push(`- Language: ${language || 'Unknown'}`);
            if (frameworks && frameworks.length > 0) {
                lines.push(`- Frameworks: ${frameworks.join(', ')}`);
            }
            lines.push(`- Source database: ${databaseType || 'Unknown'}`);
            if (databaseAccess) {
                lines.push(`- Database access: ${databaseAccess}`);
            }
            lines.push(
                '',
                "Use this information to narrow your file searches (e.g., filter by the project's file extension and search for framework-specific entity/ORM patterns).",
            );
        }
    }

    lines.push(
        '',
        'Task 1 — Generate the database schema files',
        '',
        '- Scan the workspace for database entity definitions, ORM mappings (e.g., EF Core, Hibernate/JPA, SQLAlchemy, Sequelize, TypeORM, ActiveRecord), repository or data-access-layer classes, raw SQL queries, stored procedures, triggers, and migration scripts.',
        '- Identify all tables/entities, their columns (with types), primary keys, foreign keys, unique constraints, indexes, and notable check/default constraints.',
        '- Group the discovered entities into bounded-context **domains** based on the code organization (folders, namespaces, modules, package names) and on relationship clusters (entities that reference each other via foreign keys). Examples of likely domain names: `Orders`, `Inventory`, `Identity`, `Billing`, `Catalog`. Prefer the naming used in the source code when obvious.',
        `- For each domain, emit **one consolidated SQL file** at \`${schemaFolderRelativePath}/{Domain}.sql\` containing the \`CREATE TABLE\` statements for every table in that domain, followed by index and constraint statements. Use the dialect of the source database when known (e.g., T-SQL for SQL Server, PL/pgSQL for PostgreSQL); otherwise use ANSI SQL.`,
        '- Above each `CREATE TABLE` statement, add a short SQL comment block with: (a) a one-line description of the entity, and (b) a relative markdown link to the source file with a line-number anchor where the entity is defined (e.g., `-- Source: [Order.cs](../../src/Domain/Orders/Order.cs#L12)`). Compute link paths relative to the generated SQL file so they resolve when opened.',
        '- If an entity is referenced in code but its full shape cannot be determined, still emit a `CREATE TABLE` for it with the best-effort columns you can infer and add a SQL comment `-- TODO: verify columns/types — inferred from usage`.',
        '- Do NOT emit data (`INSERT`) statements. Schema only.',
        '- After writing the files, print a short summary listing each domain, the number of tables in it, and any tables you flagged as needing verification.',
        '',
        'Task 2 — Update the access-patterns template (only when it is still empty)',
        '',
        `- Inspect the access-patterns template at #file:${accessPatternsTemplatePath}.`,
        '- If the template already contains user-filled rows (i.e., the example rows have been replaced or new rows added), leave it untouched and skip this task.',
        '- Otherwise, populate it with the read/write access patterns you discovered while scanning the workspace for Task 1, following the same conventions used by the standalone access-patterns analysis:',
        '  - Pattern IDs: `R###` for reads, `W###` for writes. Unique combination of ID and Pattern Name per row.',
        '  - Every table emitted in Task 1 MUST appear in at least one access pattern. When no code reference exists, infer typical CRUD patterns from FKs/indexes and mark them with `(schema-inferred)` in the Notes column.',
        '  - For patterns discovered in code, include evidence in Notes: a `<br>` followed by a relative markdown link to the source file with a `#L{line}` anchor and, where possible, the function name.',
        '  - Estimate Frequency (TPS) and Latency Requirement based on the nature of the operation; mark guesses with `(estimated)`.',
        '- Keep the existing markdown structure (Read Patterns / Write Patterns sections) intact.',
    );

    if (discoveryInstructions) {
        lines.push('', 'Custom discovery instructions:', discoveryInstructions);
    }

    return lines.join('\n');
}
