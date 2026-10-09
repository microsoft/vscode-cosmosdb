// Purpose: Resolve and validate deterministic item identity mappings for migrated data.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { showHelp } from './cli-help.mjs';
import { readJsonObject } from './phase-summary.mjs';
import {
    canonicalStringify,
    canonicalizeCosmosModel,
    classifyItemIdentity,
    isUuidSourceType,
} from './validate-cosmos-model.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const GENERATED_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_ID_BYTES = 1023;

export function identityModelHash(model) {
    return createHash('sha256').update(canonicalStringify(canonicalizeCosmosModel(model))).digest('hex');
}

export function readIdentityManifest(modelPath) {
    const filePath = path.join(path.dirname(modelPath), 'manifest.json');
    if (!fs.existsSync(filePath)) return undefined;
    return readJsonObject(filePath).identityMapping;
}

function typedValue(value) {
    if (typeof value === 'string') {
        if (Buffer.from(value, 'utf8').toString('utf8') !== value) throw new Error('Identity contains invalid Unicode; a lossless source representation is required.');
        return `s${Buffer.from(value, 'utf8').toString('hex')}`;
    }
    if (typeof value === 'boolean') return value ? 'b1' : 'b0';
    if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) {
        return `n${Buffer.from(String(value), 'utf8').toString('hex')}`;
    }
    throw new Error('Identity components must be lossless scalar values; use strings for unsafe integers.');
}

function checkIdByteLength(id) {
    const byteLength = Buffer.byteLength(id, 'utf8');
    if (byteLength > MAX_ID_BYTES) {
        throw new Error(
            `Resolved ID exceeds the ${MAX_ID_BYTES}-byte limit (${byteLength} UTF-8 bytes); choose a bounded mapping without truncation.`,
        );
    }
}

export function resolveItemId(entity, item, mapping) {
    const placeholders = [...entity.idTemplate.matchAll(/\{([^{}]+)\}/gu)];
    const identityKind = classifyItemIdentity(entity);
    if (identityKind === 'generated-uuid') {
        if (mapping !== undefined) {
            throw new Error('Generated UUID fallback does not use a schema-conversion identity mapping.');
        }
        if (typeof item.id !== 'string' || !GENERATED_UUID_PATTERN.test(item.id)) {
            throw new Error('Generated UUID fallback requires a valid UUID persisted as the item id.');
        }
        checkIdByteLength(item.id);
        return item.id;
    }
    if (mapping?.encoding === 'typed-hex-v1' && identityKind === 'native-uuid') {
        throw new Error('Native UUID identity must preserve its source value.');
    }
    const components = placeholders.map(match => {
        const attributes = entity.attributes.filter(attribute => attribute.target !== 'id' && attribute.source?.column === match[1]);
        if (attributes.length !== 1 || !Object.hasOwn(item, attributes[0].target)) throw new Error('Identity source key is missing or ambiguous.');
        const value = item[attributes[0].target];
        typedValue(value);
        if (isUuidSourceType(attributes[0].source?.type) && (typeof value !== 'string' || !UUID_PATTERN.test(value))) {
            throw new Error('UUID identity components must be UUID strings.');
        }
        return value;
    });
    let id;
    if (mapping?.encoding === 'typed-hex-v1') {
        id = `v1-${typedValue(entity.sourceTable)}-${typedValue(entity.name)}-${components.map(typedValue).join('-')}`;
    } else {
        const separators = entity.idTemplate.split(/\{[^{}]+\}/gu).slice(1, -1);
        if (components.some(value => separators.some(separator => !separator || String(value).includes(separator)))) {
            throw new Error('Ambiguous composite identity requires an explicit identity mapping.');
        }
        let index = 0;
        id = entity.idTemplate.replace(/\{[^{}]+\}/gu, () => String(components[index++]));
        if (/[\/\\?#]/u.test(id) || /\s$/u.test(id)) throw new Error('Unsafe template-derived identity requires an explicit identity mapping; do not sanitize it.');
        if (identityKind === 'native-uuid' && !UUID_PATTERN.test(id)) {
            throw new Error('Native UUID identity must be a UUID string.');
        }
    }
    checkIdByteLength(id);
    return id;
}

export function validateIdentityManifest(model, manifest) {
    if (manifest === undefined) return [];
    const errors = [];
    const fail = message => errors.push({ path: '$.identityMapping', message });
    if (manifest?.version !== 1 || manifest.modelSha256 !== identityModelHash(model) || !Array.isArray(manifest.mappings)) {
        fail('Identity manifest must be version 1 and match the canonical model hash.');
        return errors;
    }
    const seen = new Set();
    for (const mapping of manifest.mappings) {
        if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) { fail('Identity mappings must be objects.'); continue; }
        const entity = model.containers.find(container => container.name === mapping?.containerName)?.entities.find(value => value.docType === mapping?.docType && value.isEmbeddedOnly !== true);
        const key = JSON.stringify([mapping?.containerName, mapping?.docType]);
        const allowed = new Set(['containerName', 'docType', 'sourceTable', 'idTemplate', 'encoding', 'rule']);
        if (Object.keys(mapping).some(field => !allowed.has(field))) fail('Unsupported identity mapping property.');
        if (!entity || seen.has(key) || !['legacy', 'typed-hex-v1'].includes(mapping.encoding) || mapping.sourceTable !== entity?.sourceTable || mapping.idTemplate !== entity?.idTemplate) fail('Unknown, duplicate, or mismatched identity mapping.');
        if (typeof mapping.rule !== 'string' || !mapping.rule.trim()) fail('Identity mapping requires a peer rule.');
        const identityKind = classifyItemIdentity(entity);
        if (mapping.encoding === 'typed-hex-v1' && identityKind === 'native-uuid') fail('Native UUID identity must retain direct source-value encoding.');
        if (identityKind === 'generated-uuid') {
            fail('Generated UUID fallback must not use a schema-conversion identity mapping.');
        }
        seen.add(key);
    }
    return errors;
}

export function runCli(argv) {
    if (showHelp(argv, `
Usage: node identity-mapping.mjs <model.json> <container> <docType> <item.json>

Resolve the Cosmos item ID for one standalone entity. Read-only; outputs JSON {id}.
File paths resolve from the current working directory. All four positional values are required.
Reads identity mappings from the model's sibling manifest.json when present.
The item must supply the source fields needed by the entity's identity template.
Exit: 0 when resolved; 1 for unknown entities, invalid mappings, missing values, or I/O errors.
`)) return 0;
    try {
        if (argv.length !== 4) throw new Error('Usage: identity-mapping.mjs <model.json> <container> <docType> <item.json>');
        const [modelPath, containerName, docType, itemPath] = argv;
        const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
        const manifest = readIdentityManifest(modelPath);
        const errors = validateIdentityManifest(model, manifest);
        if (errors.length) throw new Error(JSON.stringify(errors));
        const entity = model.containers.find(container => container.name === containerName)?.entities.find(value => value.docType === docType && value.isEmbeddedOnly !== true);
        if (!entity) throw new Error('Unknown standalone entity');
        const mapping = manifest?.mappings.find(value => value.containerName === containerName && value.docType === docType);
        const id = resolveItemId(entity, JSON.parse(fs.readFileSync(itemPath, 'utf8')), mapping);
        process.stdout.write(`${JSON.stringify({ id })}\n`);
        return 0;
    } catch (error) { process.stderr.write(`${error.message}\n`); return 1; }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCli(process.argv.slice(2));
