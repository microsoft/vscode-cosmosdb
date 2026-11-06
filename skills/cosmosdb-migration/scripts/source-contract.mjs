// Purpose: Shared, bounded source inventory and lineage contract; no source-engine registry or executable hooks.

import { createHash } from 'node:crypto';

export const SOURCE_CONTRACT_VERSION = 2;
const text = value => typeof value === 'string' && value.trim().length > 0;
const array = (value, label) => {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
    return value;
};
const requireText = (value, label) => {
    if (!text(value)) throw new Error(`${label} must be a non-empty string`);
};
const unique = (values, label) => {
    if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
};
const stableId = (kind, value) => `${kind}-${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

export function validateFieldPath(value) {
    if (!Array.isArray(value) || !value.length || value.length > 128) throw new Error('Field path needs 1..128 typed segments');
    for (const segment of value) {
        if (segment?.kind === 'property' && typeof segment.name === 'string' &&
            Object.keys(segment).every(key => ['kind', 'name'].includes(key))) continue;
        if (segment?.kind === 'array' && Object.keys(segment).length === 1) continue;
        throw new Error('Field paths use {kind:"property",name:string} or {kind:"array"}, never dotted strings');
    }
}

export function domainSources(domain) {
    if (domain.datasets !== undefined && domain.tables !== undefined) throw new Error('Use datasets or legacy tables, not both');
    return domain.datasets ?? domain.tables;
}

export function sourceDatasets(inventory) {
    return inventory.datasets ?? inventory.tables;
}

export function datasetKey(dataset) {
    return dataset.id ?? dataset.name;
}

export function entitySource(entity) {
    return entity.sourceDataset ?? entity.sourceTable;
}

export function sourceRefs(source) {
    if (source?.generated !== undefined || source?.table === '(generated)') return [];
    if (Array.isArray(source?.inputs)) return source.inputs;
    return [{ dataset: source?.dataset ?? source?.table, field: source?.field ?? source?.column }];
}

export function datasetFields(dataset) {
    return dataset.fields ?? dataset.columns.map(column => ({ ...column, id: column.name, nativeTypes: [column.type] }));
}

export function resolveField(dataset, reference, legacy = false) {
    const field = datasetFields(dataset).find(value => legacy
        ? (value.name ?? (value.path?.length === 1 ? value.path[0].name : undefined)) === reference
        : value.id === reference);
    if (!field) throw new Error(`Unknown source field: ${datasetKey(dataset)}.${reference}`);
    return field;
}

export function resolvedSourceRefs(source, resolve) {
    return sourceRefs(source).map(reference => {
        const dataset = resolve(reference.dataset);
        const field = resolveField(dataset, reference.field, source.table !== undefined);
        return { dataset, field };
    });
}

export function relationalDetails(dataset) {
    return dataset.relational ?? (dataset.columns ? dataset : undefined);
}

export function primaryFields(dataset) {
    const relational = relationalDetails(dataset);
    if (!relational) return dataset.identities?.find(identity => identity.kind === 'primary' || identity.kind === 'native')?.fields ?? [];
    return relational.primaryKey.map(name =>
        dataset.fields?.find(field => field.path.length === 1 && field.path[0].kind === 'property' && field.path[0].name === name)?.id ?? name);
}

// Called only after validating the original v1 files, parser choice, hash, and exact relational keys.
export function normalizeLegacyInventory(inventory) {
    const datasets = inventory.tables.map(table => {
        const id = stableId('dataset', table.identity);
        const fields = table.columns.map(column => ({
            ...column, id: stableId('field', [id, column.name]),
            path: [{ kind: 'property', name: column.name }], nativeTypes: [column.type],
            presence: 'unknown', nullable: column.nullable ?? null,
        }));
        return { ...table, id, kind: 'relational', fields, relational: { ...table }, legacy: true };
    });
    return { ...inventory, normalizedVersion: 2, datasets };
}

export function normalizeDomains(domains, resolve) {
    return domains.map(domain => {
        const datasets = domainSources(domain).map(value => datasetKey(resolve(value)));
        const { tables: _tables, ...rest } = domain;
        return { ...rest, datasets };
    });
}

export function validateSourceContract(inventory) {
    if (inventory?.version !== 2) throw new Error('Source inventory version must be 2');
    requireText(inventory.source?.engine, 'Source engine');
    if (inventory.source.version !== null) requireText(inventory.source.version, 'Source version or null');
    array(inventory.source.namespaces, 'Source namespaces').forEach(value => requireText(value, 'Namespace'));
    const files = array(inventory.files, 'Source files');
    if (!files.length) throw new Error('Source inventory needs selected evidence');
    unique(files.map(file => file.path), 'evidence path');
    const evidencePaths = new Set(files.filter(file => file.disposition === 'used').map(file => file.path));
    const evidence = (values, label) => {
        if (!array(values, `${label} evidence`).length || values.some(value => !evidencePaths.has(value))) {
            throw new Error(`${label} requires used evidence paths`);
        }
    };
    for (const file of files) {
        requireText(file.path, 'Evidence path');
        if (!/^[0-9a-f]{64}$/u.test(file.sha256 ?? '')) throw new Error('Evidence requires SHA-256');
        if (!['ddl', 'metadata', 'code', 'sample', 'documentation'].includes(file.kind) ||
            !['used', 'conflicting', 'unusable', 'excluded'].includes(file.disposition)) throw new Error('Invalid evidence kind or disposition');
        if (/\.(?:sql|ddl)$/iu.test(file.path) && file.kind !== 'ddl') throw new Error('Selected SQL/DDL cannot be relabeled');
        requireText(file.rationale, 'Evidence rationale');
        requireText(file.provenance?.method, 'Evidence acquisition method');
        requireText(file.provenance?.scope, 'Evidence acquisition scope');
    }
    for (const capability of array(inventory.source.capabilities, 'Source capabilities')) {
        requireText(capability.name, 'Capability name');
        evidence(capability.evidence, 'Capability');
    }
    if (!Array.isArray(inventory.errors) || inventory.errors.length) throw new Error('Source inventory contains unresolved acquisition errors');
    const datasets = array(inventory.datasets, 'Datasets');
    if (!datasets.length) throw new Error('Source inventory requires datasets');
    unique(datasets.map(dataset => dataset.id), 'dataset ID');
    const byId = new Map(datasets.map(dataset => [dataset.id, dataset]));
    const endpoint = value => {
        const dataset = byId.get(value?.dataset);
        if (!dataset) throw new Error('Unknown relationship dataset');
        const fields = array(value.fields, 'Relationship fields');
        if (fields.some(id => !dataset.fields.some(field => field.id === id))) throw new Error('Unknown relationship field');
        unique(fields, 'relationship field');
        return dataset;
    };
    for (const dataset of datasets) {
        requireText(dataset.id, 'Dataset ID');
        requireText(dataset.name, 'Native dataset name');
        if (!['relational', 'document', 'other'].includes(dataset.kind)) throw new Error('Invalid dataset kind');
        evidence(dataset.evidence, 'Dataset');
        const coverage = dataset.coverage;
        if (!['declared', 'observed', 'code', 'inferred'].includes(coverage?.basis) ||
            typeof coverage.complete !== 'boolean') throw new Error('Coverage requires basis and completeness');
        requireText(coverage.scope, 'Coverage scope');
        if (coverage.basis !== 'declared' && coverage.complete) throw new Error('Samples/code/inference cannot certify complete deployed schema');
        if (coverage.basis === 'observed') {
            requireText(coverage.sampling?.method, 'Sampling method');
            requireText(coverage.sampling?.limitations, 'Sampling limitations');
            if (!Number.isInteger(coverage.sampling?.size) || coverage.sampling.size < 0) throw new Error('Sampling size must be non-negative');
        } else if (coverage.sampling !== null) throw new Error('Non-observed coverage records sampling:null');
        const fields = array(dataset.fields, 'Dataset fields');
        if (!fields.length) throw new Error('Dataset requires evidenced fields');
        unique(fields.map(field => field.id), 'field ID');
        unique(fields.map(field => JSON.stringify(field.path)), 'field path');
        for (const field of fields) {
            requireText(field.id, 'Field ID');
            validateFieldPath(field.path);
            if (!array(field.nativeTypes, 'Native field types').length) throw new Error('Field requires native types or explicit unknown');
            field.nativeTypes.forEach(type => requireText(type, 'Native type'));
            if (!['required', 'optional', 'unknown'].includes(field.presence) ||
                ![true, false, null].includes(field.nullable)) throw new Error('Field must distinguish missing, null, and unknown');
            evidence(field.evidence, 'Field');
        }
        for (const identity of array(dataset.identities, 'Dataset identities')) {
            requireText(identity.id, 'Identity ID');
            if (!['primary', 'unique', 'native', 'routing'].includes(identity.kind)) throw new Error('Invalid identity kind');
            requireText(identity.scope, 'Identity scope');
            if (!array(identity.fields, 'Identity fields').length || identity.fields.some(id => !fields.some(field => field.id === id))) throw new Error('Unknown identity field');
            unique(identity.fields, 'identity field');
            evidence(identity.evidence, 'Identity');
        }
        unique(dataset.identities.map(identity => identity.id), 'identity ID');
        if (dataset.kind === 'relational' || dataset.relational !== undefined) {
            if (dataset.kind !== 'relational' || !dataset.relational) throw new Error('Relational details cannot be dropped or relabeled');
            const relational = dataset.relational;
            for (const key of ['identity', 'columns', 'primaryKey', 'foreignKeys', 'uniqueConstraints', 'checks', 'defaults', 'indexes', 'behaviors']) array(relational[key], `Relational ${key}`);
            if (relational.name !== dataset.name || fields.length !== relational.columns.length) throw new Error('Relational fields must preserve every native column');
            for (const column of relational.columns) {
                const field = fields.find(value => value.path.length === 1 && value.path[0].kind === 'property' && value.path[0].name === column.name);
                if (!field || field.nativeTypes.length !== 1 || field.nativeTypes[0] !== column.type) throw new Error('Relational native names and types must match exactly');
            }
            const primary = dataset.identities.find(identity => identity.kind === 'primary');
            if (dataset.identities.filter(identity => identity.kind === 'primary').length !== (relational.primaryKey.length ? 1 : 0)) throw new Error('Relational primary identity must match the one native primary key');
            if (JSON.stringify(primary?.fields ?? []) !== JSON.stringify(primaryFields(dataset))) throw new Error('Relational primary-key order must match native details');
            const columns = new Set(relational.columns.map(column => column.name));
            const namedColumns = values => {
                if (!array(values, 'Constraint columns').length || values.some(value => !columns.has(value))) throw new Error('Constraint references unknown columns');
                unique(values, 'constraint column');
            };
            for (const constraint of relational.uniqueConstraints) {
                if (constraint.name !== null) requireText(constraint.name, 'Unique constraint name');
                namedColumns(constraint.columns);
            }
            for (const check of relational.checks) {
                if (check.name !== null) requireText(check.name, 'Check name');
                requireText(check.expression, 'Check expression');
            }
            for (const entry of relational.defaults) {
                if (!columns.has(entry.column)) throw new Error('Default references unknown column');
                requireText(entry.expression, 'Default expression');
            }
            for (const index of relational.indexes) {
                requireText(index.name, 'Index name');
                namedColumns(array(index.columns, 'Index columns').map(column => column.name));
                if (typeof index.unique !== 'boolean' || index.columns.some(column => !['ascending', 'descending'].includes(column.direction))) throw new Error('Index requires uniqueness and ordered directions');
            }
            for (const behavior of relational.behaviors) {
                requireText(behavior.kind, 'Native behavior kind');
                requireText(behavior.definition, 'Native behavior definition');
                requireText(behavior.semantic, 'Native behavior semantic obligation');
            }
        }
    }
    for (const file of files.filter(file => file.kind === 'ddl' && file.disposition === 'used')) {
        if (!datasets.some(dataset => dataset.kind === 'relational' && dataset.evidence.includes(file.path))) throw new Error('Selected DDL requires relational inventory details');
    }
    const relationships = array(inventory.relationships, 'Relationships');
    unique(relationships.map(relationship => relationship.id), 'relationship ID');
    for (const relationship of relationships) {
        requireText(relationship.id, 'Relationship ID');
        if (!['foreign-key', 'containment', 'reference', 'association'].includes(relationship.kind)) throw new Error('Invalid relationship kind');
        if (relationship.constraintName !== undefined) requireText(relationship.constraintName, 'Constraint name');
        endpoint(relationship.from); endpoint(relationship.to);
        if (relationship.kind !== 'containment' && (!relationship.from.fields.length ||
            relationship.from.fields.length !== relationship.to.fields.length)) throw new Error('Relationship endpoints require ordered corresponding fields');
        evidence(relationship.evidence, 'Relationship');
    }
    const semantics = array(inventory.semantics, 'Semantics');
    unique(semantics.map(semantic => semantic.id), 'semantic ID');
    for (const semantic of semantics) {
        requireText(semantic.id, 'Semantic ID');
        if (!['atomicity', 'concurrency', 'ordering', 'expiration', 'deletion', 'uniqueness', 'native'].includes(semantic.kind) ||
            !['known', 'unresolved'].includes(semantic.status) || typeof semantic.required !== 'boolean') throw new Error('Invalid typed semantic obligation');
        requireText(semantic.description, 'Semantic description');
        if (!array(semantic.datasets, 'Semantic datasets').length || semantic.datasets.some(id => !byId.has(id))) throw new Error('Semantic obligation references unknown datasets');
        evidence(semantic.evidence, 'Semantic obligation');
    }
    for (const dataset of datasets.filter(entry => entry.relational)) {
        for (const behavior of dataset.relational.behaviors) {
            if (!semantics.some(semantic => semantic.id === behavior.semantic && semantic.datasets.includes(dataset.id))) throw new Error('Native relational behavior must have an explicit semantic obligation');
        }
    }
    for (const file of files.filter(file => ['conflicting', 'unusable'].includes(file.disposition))) {
        if (!semantics.some(semantic => semantic.status === 'unresolved' && semantic.description.includes(file.path))) throw new Error('Conflicting/unusable evidence requires a visible unresolved obligation');
    }
    return inventory;
}
