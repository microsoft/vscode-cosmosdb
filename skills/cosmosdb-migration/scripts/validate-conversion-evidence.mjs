// Purpose: Validate schema conversion evidence against source inventory and domain models.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { showHelp } from './cli-help.mjs';
import { mergeCosmosModels } from './merge-cosmos-models.mjs';
import { assertNoTerminalIssues, parseJson, readDomainModel, readPhaseEvidence } from './phase-summary.mjs';
import { selectSchemaConversionDomains } from './select-schema-conversion-domains.mjs';
import { canonicalStringify, canonicalizeCosmosModel, classifyItemIdentity } from './validate-cosmos-model.mjs';
import { createSourceResolver, readSourceInventory, resolveForeignKey, validateNativeSourceInventory } from './validate-source-evidence.mjs';
import { datasetFields, datasetKey, domainSources, entitySource, normalizeDomains, primaryFields, relationalDetails, resolvedSourceRefs } from './source-contract.mjs';
import { validateMappingEvidence } from './mapping-examples.mjs';

export function modelHash(model) {
    return createHash('sha256').update(canonicalStringify(canonicalizeCosmosModel(model))).digest('hex');
}

function preservedSourceColumns(entity, table, resolve) {
    return new Set(entity.attributes.filter(attribute =>
        entity.isEmbeddedOnly === true || (attribute.target !== 'id' && attribute.isId !== true),
    ).flatMap(attribute => resolvedSourceRefs(attribute.source, resolve)
        .filter(reference => datasetKey(reference.dataset) === datasetKey(table))
        .map(reference => reference.field.id)));
}

export function validateConversionEvidence(project, inventory, domainModels, root, evidence) {
    try {
        if (inventory.version === 2) validateNativeSourceInventory(inventory);
        const resolve = createSourceResolver(inventory);
        if (evidence?.version !== 1 || typeof evidence.includeUnmappedDomains !== 'boolean' || evidence.sourceSha256 !== inventory.sha256) throw new Error('Conversion evidence requires version, explicit selection policy and current source hash');
        assertNoTerminalIssues(evidence.blockingIssues);
        const selected = normalizeDomains(selectSchemaConversionDomains(project, evidence.includeUnmappedDomains).selectedDomains, resolve);
        const expectedNames = selected.map(domain => domain.name).sort();
        const sameNames = values => JSON.stringify([...values].sort()) === JSON.stringify(expectedNames);
        if (!sameNames(project.phases.schemaConversion?.domains ?? []) || !sameNames(domainModels.map(entry => entry.domainName)) || !sameNames(Object.keys(evidence.domainSha256 ?? {}))) throw new Error('Selected, checkpoint and supplied conversion domains differ');
        const owners = new Map();
        for (const domain of selected) {
            for (const source of domainSources(domain)) {
                const table = resolve(source);
                if (owners.has(datasetKey(table))) throw new Error(`Duplicate authoritative owner: ${table.name}`);
                owners.set(datasetKey(table), domain.name);
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
                const sourceTable = resolve(entitySource(entity));
                const source = datasetKey(sourceTable);
                if (!owners.has(source)) throw new Error(`Unselected source mapping: ${source}`);
                const key = JSON.stringify([domainName, container.name, entity.name]);
                mapped.set(key, { source, entity });
                if (explicitOwnership === undefined) {
                    if (owners.get(source) !== domainName || covered.has(source)) throw new Error(`Missing or duplicate source ownership: ${source}`);
                    covered.set(source, entity);
                }
                for (const attribute of entity.attributes) {
                    for (const { dataset, field } of resolvedSourceRefs(attribute.source, resolve)) {
                        if (!owners.has(datasetKey(dataset))) throw new Error(`Attribute maps an unselected source: ${dataset.name}`);
                        if (inventory.version === 2 && attribute.source.type !== undefined && !attribute.source.inputs && !field.nativeTypes.includes(attribute.source.type)) throw new Error('Attribute source type differs from inventory native type');
                        if (inventory.version === 2 && attribute.target !== 'id' &&
                            ((field.presence !== 'required' && !attribute.optional) || (field.nullable !== false && !attribute.nullable))) {
                            throw new Error('Mapping must preserve missing/null/unknown distinctions');
                        }
                    }
                }
                for (const relationship of entity.relationships ?? []) {
                    const foreignKey = resolveForeignKey(relationship.sourceRelationship ?? relationship.sourceFK, inventory, resolve);
                    if (!owners.has(datasetKey(foreignKey.table)) || !owners.has(datasetKey(foreignKey.referencedTable))) {
                        throw new Error('Relationship maps an unselected source foreign-key endpoint');
                    }
                    const targetEntity = entities.get(relationship.targetEntity.toLocaleLowerCase('en-US'));
                    const endpoints = new Set([
                        datasetKey(sourceTable),
                        datasetKey(resolve(entitySource(targetEntity))),
                    ]);
                    if (!endpoints.has(datasetKey(foreignKey.table)) || !endpoints.has(datasetKey(foreignKey.referencedTable))) {
                        throw new Error(
                            `Relationship foreign-key endpoints do not match ${entity.name} and ${targetEntity.name}`,
                        );
                    }
                }
                const preservedColumns = preservedSourceColumns(entity, sourceTable, resolve);
                const native = relationalDetails(sourceTable);
                const idColumns = entity.identity?.fields?.filter(reference => reference.dataset === source).map(reference => reference.field) ??
                    [...(entity.idTemplate ?? '').matchAll(/\{([^{}]+)\}/gu)].map(match =>
                        datasetFields(sourceTable).find(field => (field.name ?? field.path?.[0]?.name) === match[1])?.id);
                const generatedId = classifyItemIdentity(entity) === 'generated-uuid';
                for (const column of primaryFields(sourceTable)) {
                    if (!preservedColumns.has(column)) throw new Error(`Primary-key column is not preserved separately: ${source}.${column}`);
                    if (entity.isEmbeddedOnly !== true && !generatedId && !idColumns.includes(column)) throw new Error(`idTemplate omits source primary-key column: ${source}.${column}`);
                }
                if (native && entity.isEmbeddedOnly !== true && !generatedId &&
                    JSON.stringify(idColumns.filter(column => primaryFields(sourceTable).includes(column))) !== JSON.stringify(primaryFields(sourceTable))) throw new Error('Identity must preserve composite primary-key order');
            }
        }
        if (explicitOwnership !== undefined) {
            const usedMappings = new Set();
            for (const disposition of explicitOwnership) {
                const source = datasetKey(resolve(entitySource(disposition)));
                if (covered.has(source) || owners.get(source) !== disposition.domain) throw new Error(`Duplicate or incorrect source owner: ${source}`);
                if (!Array.isArray(disposition.targets) || !disposition.targets.length) throw new Error(`Missing target disposition: ${source}`);
                let authoritative = 0;
                let authoritativeEntity;
                for (const target of disposition.targets) {
                    const key = JSON.stringify([target.domain, target.container, target.entity]);
                    const mapping = mapped.get(key);
                    if (!mapping || !['authoritative', 'embedded', 'projection', 'consolidated'].includes(target.kind)) throw new Error(`Invalid target lineage: ${source}`);
                    const lineage = mapping.source === source || mapping.entity.attributes.some(attribute => resolvedSourceRefs(attribute.source, resolve).some(reference => datasetKey(reference.dataset) === source));
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
            const table = resolve(source);
            const preservedColumns = preservedSourceColumns(entity, table, resolve);
            for (const column of datasetFields(table)) {
                if (!preservedColumns.has(column.id)) throw new Error(`Authoritative target omits source column: ${source}.${column.name ?? column.id}`);
            }
        }
        if (inventory.version === 2) validateMappingEvidence(inventory, domainModels, evidence, owners);
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
        const read = filePath => parseJson(fs.readFileSync(filePath, 'utf8'));
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
