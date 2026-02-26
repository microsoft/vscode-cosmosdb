/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface TableNode {
    name: string;
    schema?: string;
    columns: string[];
}

export interface ForeignKeyEdge {
    fromTable: string;
    fromColumn: string;
    toTable: string;
    toColumn: string;
}

export interface DependencyGraph {
    tables: TableNode[];
    edges: ForeignKeyEdge[];
}

/**
 * Regex fragment that matches a single quoted identifier:
 * `name`, "name", [name], or bare name.
 */
const IDENT = '(?:`[^`]+`|"[^"]+"|\\[[^\\]]+\\]|\\w+)';

/**
 * Regex fragment that matches an optionally schema-qualified identifier:
 * schema.name, [schema].[name], `schema`.`name`, "schema"."name", or bare name.
 */
const QUALIFIED_IDENT = `(${IDENT}(?:\\.${IDENT})?)`;

/**
 * Strips quoting characters (backticks, double-quotes, square brackets) from an identifier.
 */
function stripQuotes(id: string): string {
    return id.replace(/[`"\[\]]/g, '');
}

/**
 * Parses a potentially schema-qualified identifier into its components.
 * Handles: Schema.Table, [Schema].[Table], `schema`.`table`, "schema"."table", or bare Table.
 */
export function parseQualifiedName(raw: string): { schema?: string; name: string } {
    const stripped = stripQuotes(raw);
    const dotIndex = stripped.indexOf('.');
    if (dotIndex >= 0) {
        return {
            schema: stripped.substring(0, dotIndex),
            name: stripped.substring(dotIndex + 1),
        };
    }
    return { name: stripped };
}

/**
 * Returns the display name for a table, optionally prefixed with its schema.
 */
export function qualifiedTableName(table: TableNode): string {
    return table.schema ? `${table.schema}.${table.name}` : table.name;
}

/**
 * Parses SQL DDL content to extract a dependency graph of tables (nodes)
 * and foreign key relationships (edges).
 *
 * Handles CREATE TABLE statements with inline and table-level FK constraints,
 * as well as ALTER TABLE ... ADD FOREIGN KEY statements.
 * Supports schema-qualified identifiers across SQL Server, PostgreSQL, Oracle,
 * and MySQL quoting conventions.
 */
export function buildDependencyGraph(ddlContent: string): DependencyGraph {
    const tables: TableNode[] = [];
    const edges: ForeignKeyEdge[] = [];
    const tableSet = new Set<string>();

    // Normalize line endings and remove block/line comments
    const cleaned = ddlContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');

    // Find CREATE TABLE headers — supports schema-qualified table names
    const createTableHeaderRegex = new RegExp(
        'CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?' + QUALIFIED_IDENT + '\\s*\\(',
        'gi',
    );
    let match: RegExpExecArray | null;

    while ((match = createTableHeaderRegex.exec(cleaned)) !== null) {
        const parsed = parseQualifiedName(match[1]);
        const tableName = parsed.name;
        const tableSchema = parsed.schema;
        const dedupeKey = ((tableSchema ?? '') + '.' + tableName).toLowerCase();

        // Find the matching closing ')' by tracking parenthesis depth
        const bodyStart = match.index + match[0].length;
        let parenDepth = 1;
        let bodyEnd = -1;
        for (let i = bodyStart; i < cleaned.length; i++) {
            if (cleaned[i] === '(') parenDepth++;
            else if (cleaned[i] === ')') {
                parenDepth--;
                if (parenDepth === 0) {
                    bodyEnd = i;
                    break;
                }
            }
        }
        if (bodyEnd === -1) continue; // malformed DDL, skip
        const body = cleaned.substring(bodyStart, bodyEnd);

        if (tableSet.has(dedupeKey)) continue;
        tableSet.add(dedupeKey);

        const qualName = tableSchema ? `${tableSchema}.${tableName}` : tableName;
        const columns: string[] = [];
        const lines = body.split(',');

        // Reassemble lines that were split inside parentheses
        const reassembled: string[] = [];
        let buffer = '';
        let depth = 0;
        for (const line of lines) {
            buffer += (buffer ? ',' : '') + line;
            for (const ch of line) {
                if (ch === '(') depth++;
                else if (ch === ')') depth--;
            }
            if (depth <= 0) {
                reassembled.push(buffer.trim());
                buffer = '';
                depth = 0;
            }
        }
        if (buffer) reassembled.push(buffer.trim());

        // Regex for REFERENCES with schema-qualified target table
        const fkReferencesPattern = new RegExp(
            'REFERENCES\\s+' + QUALIFIED_IDENT + '\\s*\\(\\s*(?:`[^`]+`|"[^"]+"|\\[[^\\]]+\\]|\\w+)\\s*\\)',
            'i',
        );

        for (const line of reassembled) {
            const trimmed = line.trim();

            // Table-level FOREIGN KEY constraint
            const tableFkMatch = trimmed.match(
                new RegExp(
                    '(?:CONSTRAINT\\s+(?:`[^`]+`|"[^"]+"|\\[[^\\]]+\\]|\\w+)\\s+)?' +
                        'FOREIGN\\s+KEY\\s*\\(\\s*(?:`[^`]+`|"[^"]+"|\\[[^\\]]+\\]|\\w+)\\s*\\)\\s*' +
                        'REFERENCES\\s+' +
                        QUALIFIED_IDENT +
                        '\\s*\\(\\s*(?:`[^`]+`|"[^"]+"|\\[[^\\]]+\\]|\\w+)\\s*\\)',
                    'i',
                ),
            );
            if (tableFkMatch) {
                // Extract the FK column (between FOREIGN KEY( and ))
                const fkColMatch = trimmed.match(/FOREIGN\s+KEY\s*\(\s*(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|(\w+))\s*\)/i);
                // Extract the referenced column (between REFERENCES ...( and ))
                const refColMatch = trimmed.match(
                    /REFERENCES\s+(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|\w+)(?:\.(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|\w+))?\s*\(\s*(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|(\w+))\s*\)/i,
                );
                const fkCol = fkColMatch
                    ? stripQuotes(fkColMatch[1] ?? fkColMatch[0].match(/\(\s*(.+?)\s*\)/)?.[1] ?? '')
                    : '';
                const refCol = refColMatch
                    ? stripQuotes(refColMatch[1] ?? refColMatch[0].match(/\(\s*(.+?)\s*\)/)?.[1] ?? '')
                    : '';
                const refParsed = parseQualifiedName(tableFkMatch[1]);
                const refQualName = refParsed.schema ? `${refParsed.schema}.${refParsed.name}` : refParsed.name;
                edges.push({
                    fromTable: qualName,
                    fromColumn: stripQuotes(fkCol),
                    toTable: refQualName,
                    toColumn: stripQuotes(refCol),
                });
                continue;
            }

            // Skip constraints, primary keys, indexes, CHECK
            if (/^\s*(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|INDEX|KEY)\b/i.test(trimmed)) continue;

            // Column definition — extract column name
            const colMatch = trimmed.match(/^(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|(\w+))\s+\w+/);
            if (colMatch) {
                const colName = stripQuotes(colMatch[1] ?? colMatch[0].split(/\s+/)[0]);
                columns.push(colName);

                // Inline REFERENCES
                const inlineFkMatch = trimmed.match(fkReferencesPattern);
                if (inlineFkMatch) {
                    const refParsed = parseQualifiedName(inlineFkMatch[1]);
                    const refQualName = refParsed.schema ? `${refParsed.schema}.${refParsed.name}` : refParsed.name;
                    const refColMatch = trimmed.match(
                        /REFERENCES\s+(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|\w+)(?:\.(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|\w+))?\s*\(\s*(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|(\w+))\s*\)/i,
                    );
                    const refCol = refColMatch
                        ? stripQuotes(refColMatch[1] ?? refColMatch[0].match(/\(\s*(.+?)\s*\)/)?.[1] ?? '')
                        : '';
                    edges.push({
                        fromTable: qualName,
                        fromColumn: colName,
                        toTable: refQualName,
                        toColumn: stripQuotes(refCol),
                    });
                }
            }
        }

        tables.push({ name: tableName, schema: tableSchema, columns });
    }

    // Handle ALTER TABLE ... ADD FOREIGN KEY — supports schema-qualified names
    const alterFkRegex = new RegExp(
        'ALTER\\s+TABLE\\s+' +
            QUALIFIED_IDENT +
            '\\s+ADD\\s+(?:CONSTRAINT\\s+(?:`[^`]+`|"[^"]+"|\\[[^\\]]+\\]|\\w+)\\s+)?' +
            'FOREIGN\\s+KEY\\s*\\(\\s*(?:`[^`]+`|"[^"]+"|\\[[^\\]]+\\]|\\w+)\\s*\\)\\s*' +
            'REFERENCES\\s+' +
            QUALIFIED_IDENT +
            '\\s*\\(\\s*(?:`[^`]+`|"[^"]+"|\\[[^\\]]+\\]|\\w+)\\s*\\)',
        'gi',
    );

    while ((match = alterFkRegex.exec(cleaned)) !== null) {
        const fromParsed = parseQualifiedName(match[1]);
        const toParsed = parseQualifiedName(match[2]);
        const fromQualName = fromParsed.schema ? `${fromParsed.schema}.${fromParsed.name}` : fromParsed.name;
        const toQualName = toParsed.schema ? `${toParsed.schema}.${toParsed.name}` : toParsed.name;

        // Extract FK column and referenced column from the raw match
        const fullMatch = match[0];
        const fkColMatch = fullMatch.match(/FOREIGN\s+KEY\s*\(\s*(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|(\w+))\s*\)/i);
        const refColMatch = fullMatch.match(
            /REFERENCES\s+(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|\w+)(?:\.(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|\w+))?\s*\(\s*(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|(\w+))\s*\)/i,
        );
        const fkCol = fkColMatch ? stripQuotes(fkColMatch[1] ?? fkColMatch[0].match(/\(\s*(.+?)\s*\)/)?.[1] ?? '') : '';
        const refCol = refColMatch
            ? stripQuotes(refColMatch[1] ?? refColMatch[0].match(/\(\s*(.+?)\s*\)/)?.[1] ?? '')
            : '';

        edges.push({
            fromTable: fromQualName,
            fromColumn: stripQuotes(fkCol),
            toTable: toQualName,
            toColumn: stripQuotes(refCol),
        });
    }

    return { tables, edges };
}

/**
 * Extracts schema groups from a dependency graph.
 * Returns a map of schema name → table names (bare, without schema prefix).
 * Tables without a schema are grouped under the empty string key.
 */
export function extractSchemaGroups(graph: DependencyGraph): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const table of graph.tables) {
        const key = table.schema ?? '';
        const list = groups.get(key) ?? [];
        list.push(table.name);
        groups.set(key, list);
    }
    return groups;
}

/**
 * Formats schema groups as a readable string for prompt injection.
 * Returns an empty string if no schemas are detected.
 */
export function formatSchemaGroups(groups: Map<string, string[]>): string {
    // If all tables are unqualified, there are no meaningful schema groups
    if (groups.size === 0 || (groups.size === 1 && groups.has(''))) {
        return '';
    }
    const lines: string[] = [];
    for (const [schema, tableNames] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (schema === '') {
            lines.push(`- **(unqualified)** (${tableNames.length} tables): ${tableNames.join(', ')}`);
        } else {
            lines.push(`- **${schema}** (${tableNames.length} tables): ${tableNames.join(', ')}`);
        }
    }
    return lines.join('\n');
}

/**
 * Serializes a dependency graph to a human-readable format suitable for an AI prompt.
 * Includes a schema groups section when schema-qualified table names are detected.
 */
export function serializeGraphForPrompt(graph: DependencyGraph): string {
    const lines: string[] = [];

    // Add schema groups section if schemas are detected
    const schemaGroups = extractSchemaGroups(graph);
    const schemaGroupsText = formatSchemaGroups(schemaGroups);
    if (schemaGroupsText) {
        lines.push(`## Schema Groups`);
        lines.push('');
        lines.push(schemaGroupsText);
        lines.push('');
    }

    lines.push(`## Tables (${graph.tables.length})`);
    lines.push('');
    for (const table of graph.tables) {
        const displayName = qualifiedTableName(table);
        lines.push(`- **${displayName}**: ${table.columns.join(', ')}`);
    }

    lines.push('');
    lines.push(`## Foreign Key Relationships (${graph.edges.length})`);
    lines.push('');
    for (const edge of graph.edges) {
        lines.push(`- ${edge.fromTable}.${edge.fromColumn} → ${edge.toTable}.${edge.toColumn}`);
    }

    return lines.join('\n');
}

/**
 * Returns a subgraph containing only the specified tables and the edges between them.
 * Supports matching by qualified name ("Schema.Table") or bare name ("Table").
 */
export function getSubgraphForTables(graph: DependencyGraph, tableNames: string[]): DependencyGraph {
    const nameSet = new Set(tableNames.map((n) => n.toLowerCase()));

    const matchesTable = (table: TableNode): boolean => {
        const qName = qualifiedTableName(table).toLowerCase();
        return nameSet.has(qName) || nameSet.has(table.name.toLowerCase());
    };

    const matchesEdgeTable = (edgeTable: string): boolean => {
        const lower = edgeTable.toLowerCase();
        if (nameSet.has(lower)) return true;
        // If edge table is qualified, also check bare name
        const dotIdx = lower.indexOf('.');
        if (dotIdx >= 0) {
            return nameSet.has(lower.substring(dotIdx + 1));
        }
        return false;
    };

    const tables = graph.tables.filter(matchesTable);
    const edges = graph.edges.filter((e) => matchesEdgeTable(e.fromTable) && matchesEdgeTable(e.toTable));
    return { tables, edges };
}
