// Purpose: Validate source discovery reports, templates, inventories, and DDL evidence.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileSha256, selectedDdlFiles, selectedDiscoveryFiles } from './freshness.mjs';
import { markdownSections, readPhaseEvidence, validateSummary } from './phase-summary.mjs';

export { selectedDdlFiles } from './freshness.mjs';
export { markdownSections } from './phase-summary.mjs';

export function sourceFilesHash(dialect, files) {
    return createHash('sha256').update(JSON.stringify({ dialect, files: [...files].sort((left, right) => left.path.localeCompare(right.path)) })).digest('hex');
}

export function sourceIdentity(value, dialect) {
    const parts = [];
    const expression = /\s*("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\]|[^.\s"`\[\]]+)\s*(\.|$)/gy;
    let match;
    while ((match = expression.exec(value))) {
        const token = match[1];
        const quoted = /^["`\[]/u.test(token);
        let name = quoted ? token.slice(1, -1).replace(/""/gu, '"').replace(/``/gu, '`').replace(/\]\]/gu, ']') : token;
        if ((!quoted && dialect === 'postgres') || dialect === 'sqlite') name = name.toLowerCase();
        if (!quoted && dialect === 'oracle') name = name.toUpperCase();
        parts.push(name);
        if (!match[2]) return parts;
    }
    throw new Error(`Invalid source identifier: ${value}`);
}

export function resolveSource(value, inventory) {
    const parts = sourceIdentity(value, inventory.dialect);
    const matches = inventory.tables.filter(table => {
        const identity = table.identity.map(part => part.name);
        return parts.length === 1 ? identity.at(-1) === parts[0] : JSON.stringify(identity) === JSON.stringify(parts);
    });
    if (matches.length !== 1) throw new Error(`Source table is missing or ambiguous: ${value}`);
    return matches[0];
}

export function resolveForeignKey(sourceFK, inventory) {
    const table = resolveSource(sourceFK.table, inventory);
    const matches = table.foreignKeys.filter(foreignKey =>
        foreignKey.columns.includes(sourceFK.column),
    );
    if (matches.length !== 1) {
        throw new Error(`Source foreign key is missing or ambiguous: ${sourceFK.table}.${sourceFK.column}`);
    }
    const foreignKey = matches[0];
    return {
        table,
        columns: foreignKey.columns,
        referencedTable: resolveSource(foreignKey.referencedTable, inventory),
        referencedColumns: foreignKey.referencedColumns,
    };
}

export function readSourceInventory(workspace, project, selectedFiles = selectedDdlFiles(workspace, project)) {
    try {
        const decision = project.phases?.discovery?.ddlParsing;
        if (!decision || !['model', 'sqlglot'].includes(decision.method)) throw new Error('Choose and persist a DDL parsing method before completing preflight');
        const evidence = readPhaseEvidence(path.join(workspace, '.cosmosdb-migration/phases/1-discovery/preflight-manifest.json'));
        const inventory = evidence.sourceInventory;
        if (inventory?.version !== 1 || inventory.parser?.method !== decision.method || !Array.isArray(inventory.errors) || inventory.errors.length) throw new Error('Source inventory must record the selected parsing method and no unresolved errors');
        if (decision.method === 'sqlglot' && (inventory.parser.name !== 'sqlglot' || typeof inventory.parser.version !== 'string' || !inventory.parser.version.trim())) throw new Error('External parsing evidence must identify SQLGlot and its version');
        if (typeof inventory.dialect !== 'string' || !inventory.dialect.trim() || !Array.isArray(inventory.files) || !selectedFiles.length) throw new Error('Source inventory requires dialect and selected source files');
        const files = selectedFiles.map(filePath => ({ path: path.relative(workspace, filePath).split(path.sep).join('/'), sha256: createHash('sha256').update(fs.readFileSync(filePath)).digest('hex') })).sort((left, right) => left.path.localeCompare(right.path));
        const recordedFiles = inventory.files.map(file => ({ path: file.path, sha256: file.sha256 })).sort((left, right) => left.path.localeCompare(right.path));
        if (JSON.stringify(files) !== JSON.stringify(recordedFiles)) throw new Error('Source inventory is stale or differs from the selected source files; repeat the chosen parsing procedure');
        if (!Array.isArray(inventory.tables) || !inventory.tables.length) throw new Error('Source inventory requires at least one recorded table definition');
        const identities = new Set();
        for (const table of inventory.tables) {
            if (typeof table?.name !== 'string' || !table.name.trim() || !Array.isArray(table.identity) || !table.identity.length || table.identity.some(part => typeof part?.name !== 'string' || !part.name)) throw new Error('Invalid source table identity');
            const key = JSON.stringify(table.identity.map(part => part.name));
            if (identities.has(key)) throw new Error('Duplicate source table identity');
            identities.add(key);
            if (!Array.isArray(table.columns) || !table.columns.length || table.columns.some(column => typeof column?.name !== 'string' || !column.name || typeof column.type !== 'string' || !column.type)) throw new Error('Table requires named, typed columns');
            const columns = new Set(table.columns.map(column => column.name));
            if (columns.size !== table.columns.length) throw new Error('Duplicate source column identity');
            if (!Array.isArray(table.primaryKey) || table.primaryKey.some(column => !columns.has(column)) || !Array.isArray(table.foreignKeys)) throw new Error('Invalid source key structure');
            for (const foreignKey of table.foreignKeys) {
                if (
                    !foreignKey ||
                    !Array.isArray(foreignKey.columns) ||
                    !foreignKey.columns.length ||
                    new Set(foreignKey.columns).size !== foreignKey.columns.length ||
                    foreignKey.columns.some(column => !columns.has(column)) ||
                    typeof foreignKey.referencedTable !== 'string' ||
                    !foreignKey.referencedTable.trim() ||
                    !Array.isArray(foreignKey.referencedColumns) ||
                    foreignKey.referencedColumns.length !== foreignKey.columns.length
                ) {
                    throw new Error(`Invalid source foreign key on ${table.name}`);
                }
            }
        }
        for (const table of inventory.tables) {
            for (const foreignKey of table.foreignKeys) {
                const referencedTable = resolveSource(foreignKey.referencedTable, inventory);
                const referencedColumns = new Set(referencedTable.columns.map(column => column.name));
                if (
                    new Set(foreignKey.referencedColumns).size !== foreignKey.referencedColumns.length ||
                    foreignKey.referencedColumns.some(column => !referencedColumns.has(column))
                ) {
                    throw new Error(`Invalid referenced columns for source foreign key on ${table.name}`);
                }
            }
        }
        const sha256 = sourceFilesHash(inventory.dialect, files);
        if (evidence.sourceSha256 !== sha256) throw new Error('Preflight evidence source hash does not match current files');
        return { ...inventory, sha256, assurance: decision.method === 'model' ? 'model-reviewed' : 'sqlglot-assisted' };
    } catch (error) { return { errors: [{ path: 'preflight-manifest.json#sourceInventory', message: error.message }] }; }
}

export function validateWorkloadInputs(workspace, project, entries) {
    const label = 'preflight-manifest.json#workloadInputs';
    try {
        const expected = new Map(['volumetrics', 'access-patterns'].flatMap(source =>
            selectedDiscoveryFiles(workspace, project, source).map(file => {
                const relative = path.relative(workspace, file).split(path.sep).join('/');
                return [`${source}:${relative}`, { file, relative }];
            }),
        ));
        if (entries === undefined && expected.size === 0) return [];
        if (!Array.isArray(entries)) return [{ path: label, message: 'Record a disposition for every selected raw workload input' }];
        const errors = [];
        for (const [index, entry] of entries.entries()) {
            const entryPath = `${label}[${index}]`;
            const key = `${entry?.source}:${entry?.path}`;
            const selected = expected.get(key);
            if (!selected) {
                errors.push({ path: entryPath, message: 'Input is unselected, duplicated, or no longer present' });
                continue;
            }
            expected.delete(key);
            if (entry.sha256 !== fileSha256(selected.file)) {
                errors.push({ path: `${entryPath}.sha256`, message: 'Input content changed; review the workload evidence again' });
            }
            if (!['used', 'excluded'].includes(entry.disposition) ||
                !['observed', 'synthetic', 'unknown'].includes(entry.evidenceKind) ||
                typeof entry.rationale !== 'string' || !entry.rationale.trim()) {
                errors.push({ path: entryPath, message: 'Input requires a disposition, evidenceKind, and substantive rationale' });
            }
        }
        for (const { relative } of expected.values()) {
            errors.push({ path: label, message: `Selected workload input has not been accounted for: ${relative}` });
        }
        return errors;
    } catch (error) {
        return [{ path: label, message: error.message }];
    }
}

function tableRows(markdown, expectedHeaders) {
    const lines = markdown.split(/\r?\n/u);
    const split = line => line.trim().replace(/^\||\|$/gu, '').split(/(?<!\\)\|/u).map(cell => cell.trim().replace(/\\\|/gu, '|'));
    const start = lines.findIndex(line => line.trim().startsWith('|') && JSON.stringify(split(line)) === JSON.stringify(expectedHeaders));
    if (start < 0 || !split(lines[start + 1] ?? '').every(cell => /^:?-{3,}:?$/u.test(cell))) throw new Error('Missing or malformed required table columns');
    const rows = [];
    for (const line of lines.slice(start + 2)) {
        if (!line.trim().startsWith('|')) break;
        const cells = split(line);
        if (cells.length !== expectedHeaders.length) throw new Error('Malformed table row');
        rows.push(Object.fromEntries(expectedHeaders.map((header, index) => [header, cells[index]])));
    }
    return rows;
}

function numeric(value, percent = false) {
    if (/^(?:N\/A|unknown)$/iu.test(value)) return;
    const cleaned = value.replace(/\s*\(estimated\)\s*$/iu, '').replace(/,/gu, '');
    if (!(percent ? /^\d+(?:\.\d+)?%?$/u : /^\d+(?:\.\d+)?$/u).test(cleaned)) throw new Error(`Expected non-negative value or explicit unknown: ${value}`);
    const numericText = cleaned.endsWith('%') ? cleaned.slice(0, -1) : cleaned;
    if (!Number.isFinite(Number(numericText))) throw new Error('Non-finite numeric value');
}

export function validateTemplates(volumetrics, accessPatterns, inventory, comparisons = []) {
    const errors = [];
    const observations = new Map();
    const verify = (label, action) => { try { action(); } catch (error) { errors.push({ path: label, message: error.message }); } };
    verify('volumetrics/volumetrics.md', () => {
        const rows = tableRows(volumetrics, ['#', 'Schema', 'Table', 'Est. Row Count', 'Avg Row Size (KB)', 'Growth Rate (month)', 'Read TPS', 'Write TPS', 'Notes']);
        const identities = new Set();
        const ids = new Set();
        for (const row of rows) {
            const table = resolveSource(row.Schema && row.Schema !== 'N/A' ? `${row.Schema}.${row.Table}` : row.Table, inventory);
            if (ids.has(row['#']) || identities.has(table.name) || !/^\d+$/u.test(row['#'])) throw new Error('Duplicate or invalid volumetric row identity');
            ids.add(row['#']); identities.add(table.name);
            for (const field of ['Est. Row Count', 'Avg Row Size (KB)', 'Read TPS', 'Write TPS']) numeric(row[field]);
            numeric(row['Growth Rate (month)'], true);
            for (const field of ['Read TPS', 'Write TPS']) observations.set(JSON.stringify(['volumetrics', table.name, field]), row[field]);
        }
        if (identities.size !== inventory.tables.length) throw new Error('Volumetrics must cover every source table, including explicit unknowns');
    });
    verify('access-patterns/access-patterns.md', () => {
        const sections = markdownSections(accessPatterns);
        const ids = new Set();
        const names = new Set();
        const tables = new Set();
        for (const [section, prefix, scope] of [['Read Patterns', 'R', 'Filter / Lookup Fields'], ['Write Patterns', 'W', 'Single / Batch']]) {
            const rows = tableRows(sections.get(section) ?? '', ['#', 'Pattern Name', 'Tables / Entities', scope, 'Frequency (TPS)', 'Latency Requirement', 'Notes']);
            for (const row of rows) {
                if (!new RegExp(`^${prefix}\\d{3,}$`, 'u').test(row['#']) || ids.has(row['#']) || !row['Pattern Name'] || names.has(row['Pattern Name'])) throw new Error('Duplicate or invalid access pattern identity');
                ids.add(row['#']); names.add(row['Pattern Name']);
                for (const name of row['Tables / Entities'].split(/,\s*/u)) tables.add(resolveSource(name, inventory).name);
                numeric(row['Frequency (TPS)']);
                observations.set(JSON.stringify(['pattern', row['#']]), row['Frequency (TPS)']);
                if (!row[scope] || !row['Latency Requirement'] || !row.Notes) throw new Error('Missing access-pattern scope, latency, or provenance');
            }
        }
        for (const table of inventory.tables) {
            if (!tables.has(table.name) && !accessPatterns.includes(`No observed application access: ${table.name}`)) throw new Error(`Missing access disposition: ${table.name}`);
        }
    });
    verify('preflight-manifest.json#comparisons', () => {
        if (!Array.isArray(comparisons)) throw new Error('Comparable observations must be an array');
        const total = references => {
            if (!Array.isArray(references) || !references.length) throw new Error('Comparison operands must reference observed values');
            return references.reduce((sum, reference) => {
                const key = reference.kind === 'pattern' ? ['pattern', reference.id] : ['volumetrics', resolveSource(reference.table, inventory).name, reference.field];
                const raw = observations.get(JSON.stringify(key));
                if (!raw || /^(?:N\/A|unknown)$/iu.test(raw)) throw new Error('Comparison references missing or unknown observations');
                return sum + Number(raw.replace(/\s*\(estimated\)\s*$/iu, '').replace(/,/gu, ''));
            }, 0);
        };
        for (const comparison of comparisons) {
            if (comparison.unit !== 'operations/second' || typeof comparison.window !== 'string' || !comparison.window.trim() || !['equal', 'gte'].includes(comparison.operator)) throw new Error('Comparison requires common TPS units, observation window and operator');
            const left = total(comparison.left);
            const right = total(comparison.right);
            if (!Number.isFinite(left + right) || (comparison.operator === 'equal' ? left !== right : left < right)) throw new Error(`Contradictory comparable observations in ${comparison.window}`);
        }
    });
    return errors;
}

export function validateSourceReport(markdown, evidence, inventory, kind, domains = [], workspace) {
    try {
        validateSummary(markdown, kind === 'discovery' ? ['Source Overview', 'Read Patterns', 'Write Patterns', 'Relational Semantics', 'Warnings'] : ['Overview', 'Domains', 'Cross-Domain Dependencies', 'Recommendations', 'Warnings']);
        if (evidence.sourceSha256 !== inventory.sha256) throw new Error('Report source hash does not match selected DDL');
        if (!Array.isArray(evidence.tables)) throw new Error('Report requires source table identities');
        const tables = evidence.tables.map(name => resolveSource(name, inventory).name);
        if (new Set(tables).size !== tables.length || tables.length !== inventory.tables.length) throw new Error('Report does not account for every source table exactly once');
        if (kind === 'discovery') {
            if (!Array.isArray(evidence.patterns) || !Array.isArray(evidence.noObservedAccess)) throw new Error('Discovery requires patterns and noObservedAccess arrays');
            const ids = new Set();
            const dispositions = new Set();
            for (const pattern of evidence.patterns) {
                if (!/^[RW]\d{3,}$/u.test(pattern?.id) || ids.has(pattern.id) || !['read', 'write'].includes(pattern.kind) || pattern.id[0] !== (pattern.kind === 'read' ? 'R' : 'W')) throw new Error('Invalid or duplicate discovery pattern');
                if (!Array.isArray(pattern.tables) || !pattern.tables.length || !Array.isArray(pattern.sourcePaths) || !['code', 'observed', 'schema-inferred', 'query-only'].includes(pattern.evidence)) throw new Error('Incomplete pattern evidence');
                if (pattern.evidence === 'code' && !pattern.sourcePaths.length) throw new Error('Code-evidenced pattern requires source files');
                if (!Number.isFinite(pattern.tps) || pattern.tps < 0) {
                    if (pattern.tps !== null) throw new Error('Pattern TPS must be non-negative or null for unknown');
                }
                if (typeof pattern.operation !== 'string' || !pattern.operation.trim()) throw new Error('Pattern operation is required');
                for (const source of pattern.tables) dispositions.add(resolveSource(source, inventory).name);
                if (workspace) for (const source of pattern.sourcePaths) {
                    if (typeof source !== 'string' || path.isAbsolute(source)) throw new Error('Evidence paths must be workspace-relative');
                    const file = source.split('#')[0];
                    const resolved = fs.realpathSync(path.resolve(workspace, file));
                    const relative = path.relative(fs.realpathSync(workspace), resolved);
                    if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(resolved).isFile()) throw new Error('Evidence path escapes the workspace or is not a file');
                }
                ids.add(pattern.id);
            }
            const noAccess = new Set();
            for (const source of evidence.noObservedAccess) {
                const table = resolveSource(source, inventory).name;
                if (dispositions.has(table) || noAccess.has(table)) throw new Error('Contradictory or duplicate no-access disposition');
                noAccess.add(table); dispositions.add(table);
            }
            if (dispositions.size !== tables.length) throw new Error('Discovery patterns omit source access dispositions');
        }
        if (kind === 'assessment') {
            const owned = domains.flatMap(domain => domain.tables.map(name => resolveSource(name, inventory).name));
            if (new Set(owned).size !== owned.length || owned.length !== tables.length) throw new Error('Assessment source ownership is missing or duplicated');
            if (!Array.isArray(evidence.domains) || JSON.stringify([...evidence.domains].sort()) !== JSON.stringify(domains.map(domain => domain.name).sort())) throw new Error('Assessment report and checkpoint domains differ');
            for (const domain of domains) if (domain.crossDomainDependencies.some(name => !domains.some(target => target.name === name))) throw new Error('Cross-domain dependency does not identify an assessed domain');
            if (!Array.isArray(evidence.crossDomainEdges)) throw new Error('Assessment requires crossDomainEdges');
            for (const edge of evidence.crossDomainEdges) {
                for (const prefix of ['from', 'to']) {
                    const owner = domains.find(domain => domain.name === edge[`${prefix}Domain`]);
                    const table = resolveSource(edge[`${prefix}Table`], inventory).name;
                    if (!owner || !owner.tables.some(source => resolveSource(source, inventory).name === table)) throw new Error('Cross-domain edge contradicts source ownership');
                }
                if (typeof edge.strategy !== 'string' || !edge.strategy.trim()) throw new Error('Cross-domain edge requires a handling strategy');
            }
        }
        return [];
    } catch (error) { return [{ path: `${kind}-report`, message: error.message }]; }
}
