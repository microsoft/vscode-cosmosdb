// Purpose: Validate schema conversion evidence against source inventory and domain models.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { showHelp } from './cli-help.mjs';
import { mergeCosmosModels } from './merge-cosmos-models.mjs';
import { assertNoTerminalIssues, readDomainModel, readPhaseEvidence } from './phase-summary.mjs';
import { selectSchemaConversionDomains } from './select-schema-conversion-domains.mjs';
import { canonicalStringify, canonicalizeCosmosModel } from './validate-cosmos-model.mjs';
import { readSourceInventory, resolveForeignKey, resolveSource } from './validate-source-evidence.mjs';

export function modelHash(model) {
    return createHash('sha256').update(canonicalStringify(canonicalizeCosmosModel(model))).digest('hex');
}

function preservedSourceColumns(entity, table, inventory) {
    return new Set(entity.attributes.filter(attribute =>
        attribute.source.table !== '(generated)' &&
        (entity.isEmbeddedOnly === true || (attribute.target !== 'id' && attribute.isId !== true)) &&
        resolveSource(attribute.source.table, inventory).name === table.name,
    ).map(attribute => attribute.source.column));
}

export function validateConversionEvidence(project, inventory, domainModels, root, evidence) {
    try {
        if (evidence?.version !== 1 || typeof evidence.includeUnmappedDomains !== 'boolean' || evidence.sourceSha256 !== inventory.sha256) throw new Error('Conversion evidence requires version, explicit selection policy and current source hash');
        assertNoTerminalIssues(evidence.blockingIssues);
        const selected = selectSchemaConversionDomains(project, evidence.includeUnmappedDomains).selectedDomains;
        const expectedNames = selected.map(domain => domain.name).sort();
        const sameNames = values => JSON.stringify([...values].sort()) === JSON.stringify(expectedNames);
        if (!sameNames(project.phases.schemaConversion?.domains ?? []) || !sameNames(domainModels.map(entry => entry.domainName)) || !sameNames(Object.keys(evidence.domainSha256 ?? {}))) throw new Error('Selected, checkpoint and supplied conversion domains differ');
        const owners = new Map();
        for (const domain of selected) {
            for (const source of domain.tables) {
                const table = resolveSource(source, inventory);
                if (owners.has(table.name)) throw new Error(`Duplicate authoritative owner: ${table.name}`);
                owners.set(table.name, domain.name);
            }
        }
        const entities = new Map(
            domainModels.flatMap(({ model }) =>
                model.containers.flatMap(container =>
                    container.entities.map(entity => [entity.name.toLocaleLowerCase('en-US'), entity]),
                ),
            ),
        );
        const covered = new Map();
        const mapped = new Map();
        const explicitOwnership = evidence.sourceDispositions;
        if (explicitOwnership !== undefined && !Array.isArray(explicitOwnership)) throw new Error('Source dispositions must be an array');
        for (const { domainName, model } of domainModels) {
            if (evidence.domainSha256[domainName] !== modelHash(model)) throw new Error(`Stale domain model hash: ${domainName}`);
            for (const container of model.containers) for (const entity of container.entities) {
                const sourceTable = resolveSource(entity.sourceTable, inventory);
                const source = sourceTable.name;
                if (!owners.has(source)) throw new Error(`Unselected source mapping: ${source}`);
                const key = JSON.stringify([domainName, container.name, entity.name]);
                mapped.set(key, { source, entity });
                if (explicitOwnership === undefined) {
                    if (owners.get(source) !== domainName || covered.has(source)) throw new Error(`Missing or duplicate source ownership: ${source}`);
                    covered.set(source, entity);
                }
                for (const attribute of entity.attributes) {
                    if (attribute.source.table === '(generated)') continue;
                    const table = resolveSource(attribute.source.table, inventory);
                    if (!owners.has(table.name)) throw new Error(`Attribute maps an unselected source: ${table.name}`);
                    if (!table.columns.some(column => column.name === attribute.source.column)) throw new Error(`Attribute maps a missing source column: ${attribute.source.table}.${attribute.source.column}`);
                }
                for (const relationship of entity.relationships ?? []) {
                    const foreignKey = resolveForeignKey(relationship.sourceFK, inventory);
                    if (!owners.has(foreignKey.table.name) || !owners.has(foreignKey.referencedTable.name)) {
                        throw new Error('Relationship maps an unselected source foreign-key endpoint');
                    }
                    const targetEntity = entities.get(relationship.targetEntity.toLocaleLowerCase('en-US'));
                    const endpoints = new Set([
                        sourceTable.name,
                        resolveSource(targetEntity.sourceTable, inventory).name,
                    ]);
                    if (!endpoints.has(foreignKey.table.name) || !endpoints.has(foreignKey.referencedTable.name)) {
                        throw new Error(
                            `Relationship foreign-key endpoints do not match ${entity.name} and ${targetEntity.name}`,
                        );
                    }
                }
                const preservedColumns = preservedSourceColumns(entity, sourceTable, inventory);
                const idColumns = new Set([...(entity.idTemplate ?? '').matchAll(/\{([^{}]+)\}/gu)].map(match => match[1]));
                for (const column of sourceTable.primaryKey ?? []) {
                    if (!preservedColumns.has(column)) throw new Error(`Primary-key column is not preserved separately: ${source}.${column}`);
                    if (entity.isEmbeddedOnly !== true && entity.idTemplate !== '{uuid}' && !idColumns.has(column)) throw new Error(`idTemplate omits source primary-key column: ${source}.${column}`);
                }
            }
        }
        if (explicitOwnership !== undefined) {
            const usedMappings = new Set();
            for (const disposition of explicitOwnership) {
                const source = resolveSource(disposition.sourceTable, inventory).name;
                if (covered.has(source) || owners.get(source) !== disposition.domain) throw new Error(`Duplicate or incorrect source owner: ${source}`);
                if (!Array.isArray(disposition.targets) || !disposition.targets.length) throw new Error(`Missing target disposition: ${source}`);
                let authoritative = 0;
                let authoritativeEntity;
                for (const target of disposition.targets) {
                    const key = JSON.stringify([target.domain, target.container, target.entity]);
                    const mapping = mapped.get(key);
                    if (!mapping || !['authoritative', 'embedded', 'projection', 'consolidated'].includes(target.kind)) throw new Error(`Invalid target lineage: ${source}`);
                    const lineage = mapping.source === source || mapping.entity.attributes.some(attribute => attribute.source.table !== '(generated)' && resolveSource(attribute.source.table, inventory).name === source);
                    if (!lineage) throw new Error(`Target lacks source lineage: ${source}`);
                    if (target.kind !== 'projection') {
                        if (target.domain !== disposition.domain) throw new Error(`Authoritative target belongs to a different domain: ${source}`);
                        authoritative++;
                        authoritativeEntity = mapping.entity;
                    }
                    if (target.kind === 'embedded' && mapping.entity.isEmbeddedOnly !== true) throw new Error('Embedded disposition requires an embedded-only entity');
                    usedMappings.add(key);
                }
                if (authoritative !== 1) throw new Error(`Source requires exactly one authoritative disposition: ${source}`);
                covered.set(source, authoritativeEntity);
            }
            if (usedMappings.size !== mapped.size) throw new Error('Undeclared entity ownership or projection');
        }
        if (covered.size !== owners.size) throw new Error('Conversion omits selected source tables');
        for (const [source, entity] of covered) {
            const table = resolveSource(source, inventory);
            const preservedColumns = preservedSourceColumns(entity, table, inventory);
            for (const column of table.columns) {
                if (!preservedColumns.has(column.name)) throw new Error(`Authoritative target omits source column: ${source}.${column.name}`);
            }
        }
        const expected = mergeCosmosModels(domainModels, { databaseName: evidence.databaseName, capacityMode: evidence.capacityMode, capacityEvidence: evidence.capacityEvidence });
        if (!expected.model) throw new Error(`Merge failed: ${JSON.stringify([...expected.errors, ...expected.conflicts])}`);
        if (canonicalStringify(canonicalizeCosmosModel(root)) !== canonicalStringify(expected.model)) throw new Error('Root model differs from the deterministic merge of accepted domain models');
        return [];
    } catch (error) { return [{ path: '$.conversionEvidence', message: error.message }]; }
}

export function runCli(argv) {
    if (showHelp(argv, `
Usage: node validate-conversion-evidence.mjs <workspace>

Read-only cross-check of source inventory, accepted domain models, root manifest,
and deterministic root merge. The workspace is required and positional, not --workspace.
Reads artifacts under <workspace>/.cosmosdb-migration; relative workspace resolves from cwd.
Use only to isolate an evidence failure; phase completion already includes this validation.
Outputs JSON {valid, errors}. Exit: 0 when valid; 1 for validation or I/O failures.
`)) return 0;
    try {
        if (argv.length !== 1) throw new Error('Usage: validate-conversion-evidence.mjs <workspace>');
        const workspace = path.resolve(argv[0]);
        const migrationRoot = path.join(workspace, '.cosmosdb-migration');
        const conversionRoot = path.join(migrationRoot, 'phases/3-schema-conversion');
        const read = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const project = read(path.join(migrationRoot, 'project.json'));
        const evidence = readPhaseEvidence(path.join(conversionRoot, 'manifest.json'));
        const domains = selectSchemaConversionDomains(project, evidence.includeUnmappedDomains).selectedDomains.map(domain => {
            if (/[\\/]/u.test(domain.name) || domain.name === '..') throw new Error('Invalid domain artifact path');
            return { domainName: domain.name, model: readDomainModel(path.join(conversionRoot, 'domains', domain.name, 'cosmos-model.json')) };
        });
        const inventory = readSourceInventory(workspace, project);
        const errors = inventory.errors.length ? inventory.errors : validateConversionEvidence(project, inventory, domains, read(path.join(conversionRoot, 'model.json')), evidence);
        process.stdout.write(`${JSON.stringify({ valid: !errors.length, errors }, null, 2)}\n`);
        return errors.length ? 1 : 0;
    } catch (error) { process.stderr.write(`${error.message}\n`); return 1; }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCli(process.argv.slice(2));
