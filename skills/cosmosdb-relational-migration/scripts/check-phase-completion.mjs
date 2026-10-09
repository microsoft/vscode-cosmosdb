#!/usr/bin/env node
// Purpose: Determine whether a migration phase has complete and current evidence.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCompatibilityReport } from './check-sdk-compatibility.mjs';
import { requireOptionValue } from './cli-arguments.mjs';
import { showHelp } from './cli-help.mjs';
import { validateFreshnessManifest } from './freshness.mjs';
import { buildProvisioningArtifacts } from './generate-provisioning-artifacts.mjs';
import { readIdentityManifest, validateIdentityManifest } from './identity-mapping.mjs';
import { normalizePhaseName } from './phase-names.mjs';
import { readDomainModel, readPhaseEvidence, readSdkCompatibility, validateSummary as validateMarkdownSummary } from './phase-summary.mjs';
import { validateCodeMigrationRecord } from './validate-code-migration-plan.mjs';
import { validateConversionEvidence } from './validate-conversion-evidence.mjs';
import {
    canonicalStringify,
    canonicalizeCosmosModel,
    validateCosmosModel,
} from './validate-cosmos-model.mjs';
import { validateMigrationProject } from './validate-migration-project.mjs';
import { validateProvisioningVerification } from './validate-provisioning-verification.mjs';
import { validateSampleData } from './validate-sample-data.mjs';
import {
    readExpectedPatternIdsByDomain,
    validateSchemaConversionSummary,
} from './validate-schema-conversion-summary.mjs';
import { readSourceInventory, selectedDdlFiles, validateSourceReport, validateTemplates, validateWorkloadInputs } from './validate-source-evidence.mjs';

export const MAX_COMPLETION_OUTPUT_BYTES = 16 * 1024;
export const DEFAULT_COMPLETION_PAGE_SIZE = 20;

function exists(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

function nonEmpty(filePath) {
    return exists(filePath) && fs.statSync(filePath).size > 0;
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return undefined;
    }
}

function addArtifact(artifacts, workspace, filePath, description, validator = nonEmpty, conditional = false) {
    const present = exists(filePath);
    let valid = false;
    let diagnostics;
    if (present) {
        try {
            const result = validator(filePath);
            valid = Array.isArray(result) ? result.length === 0 : result === true;
            if (Array.isArray(result) && result.length) diagnostics = result;
        } catch (error) {
            valid = false;
            diagnostics = [{ path: path.relative(workspace, filePath), message: error.message }];
        }
    }
    artifacts.push({
        path: path.relative(workspace, filePath),
        description,
        conditional,
        state: !present ? 'missing' : valid ? 'present' : 'invalid',
        ...(diagnostics ? { diagnostics } : {}),
    });
}

function validateJson(filePath) {
    return readJson(filePath) !== undefined;
}

function validateSdkReport(filePath, project) {
    const { sdkReport: report } = readSdkCompatibility(filePath);
    const detectedLanguages = String(project.phases.discovery.applicationAnalysis?.language ?? '')
        .split(',')
        .map((language) => language.trim())
        .filter(Boolean);
    return validateCompatibilityReport(report, detectedLanguages).errors.map(error => ({
        path: `discovery-manifest.json#sdkCompatibility${error.path.slice(1)}`,
        message: error.message,
    }));
}

function validatePreflightManifest(filePath, inventory, workspace, project) {
    const evidence = readPhaseEvidence(filePath);
    const errors = validateWorkloadInputs(workspace, project, evidence.workloadInputs);
    if (evidence.sourceSha256 !== inventory.sha256) {
        errors.push({ path: 'preflight-manifest.json#sourceSha256', message: 'must match the current source inventory' });
    }
    if (Object.hasOwn(evidence, 'sdkCompatibility')) {
        errors.push({ path: 'preflight-manifest.json', message: 'must not contain discovery-owned SDK compatibility' });
    }
    return errors;
}

function validateMarkdownFile(filePath, requiredSections) {
    validateMarkdownSummary(fs.readFileSync(filePath, 'utf8'), requiredSections);
    return true;
}

function markdownTableRows(content, headerPattern) {
    const lines = content.split(/\r?\n/gu);
    const headerIndex = lines.findIndex((line) => headerPattern.test(line));
    if (headerIndex < 0 || !/^\s*\|\s*:?-{3,}/u.test(lines[headerIndex + 1] ?? '')) return [];
    const rows = [];
    for (const line of lines.slice(headerIndex + 2)) {
        if (!line.trim().startsWith('|')) break;
        rows.push(line);
    }
    return rows;
}

function validateVolumetrics(filePath) {
    if (!nonEmpty(filePath)) return false;
    const content = fs.readFileSync(filePath, 'utf8');
    const rows = markdownTableRows(content, /\|\s*#\s*\|\s*Schema\s*\|\s*Table\s*\|/iu);
    return /^#\s+Volumetrics\s*$/mu.test(content) && rows.some((row) => row.split('|')[3]?.trim());
}

function validateAccessPatterns(filePath) {
    if (!nonEmpty(filePath)) return false;
    const content = fs.readFileSync(filePath, 'utf8');
    const readRows = markdownTableRows(content, /\|\s*#\s*\|\s*Pattern Name\s*\|\s*Tables \/ Entities\s*\|/iu);
    const writeHeader = content.lastIndexOf('| # | Pattern Name | Tables / Entities |');
    const writeContent = writeHeader >= 0 ? content.slice(writeHeader) : '';
    const writeRows = markdownTableRows(writeContent, /\|\s*#\s*\|\s*Pattern Name\s*\|\s*Tables \/ Entities\s*\|/iu);
    return (
        /^#\s+Access Patterns\s*$/mu.test(content) &&
        /^##\s+Read Patterns\s*$/mu.test(content) &&
        /^##\s+Write Patterns\s*$/mu.test(content) &&
        (readRows.some((row) => row.split('|')[2]?.trim()) ||
            writeRows.some((row) => row.split('|')[2]?.trim()) ||
            /no observed (?:application )?access/iu.test(content))
    );
}

function validateModel(filePath, referenceRegistry = []) {
    const model = readJson(filePath);
    return (
        model !== undefined &&
        validateCosmosModel(model, { referenceRegistry }).length === 0 &&
        validateIdentityManifest(model, readIdentityManifest(filePath)).length === 0 &&
        fs.readFileSync(filePath, 'utf8') === canonicalStringify(canonicalizeCosmosModel(model))
    );
}

function validateDomainManifest(filePath, referenceRegistry = []) {
    const model = readDomainModel(filePath);
    return validateCosmosModel(model, { referenceRegistry }).length === 0;
}

function validateConversionSummary(
    filePath,
    kind,
    modelPath,
    domainManifestPath,
    referenceRegistry = [],
    expectedPatternIds = [],
) {
    const model = kind === 'domain' ? readDomainModel(domainManifestPath) : modelPath ? readJson(modelPath) : undefined;
    if ((kind === 'domain' || modelPath) && (model === undefined || validateCosmosModel(model, { referenceRegistry }).length > 0)) return false;
    const expectedDocTypes = model?.containers?.flatMap((container) =>
        container.entities.map((entity) => entity.docType),
    );
    if (!nonEmpty(filePath)) return false;
    return validateSchemaConversionSummary(fs.readFileSync(filePath, 'utf8'), kind, {
        expectedDocTypes,
        expectedPatternIds,
    });
}

function validateSampleDataFile(filePath, modelPath, sourceInventory) {
    const model = readJson(modelPath);
    const sampleData = readJson(filePath);
    return model !== undefined &&
        sampleData !== undefined &&
        validateSampleData(model, sampleData, readIdentityManifest(modelPath), sourceInventory).length === 0;
}

function validateGeneratedProvisioningArtifact(
    filePath,
    artifactName,
    modelPath,
    sampleDataPath,
    project,
    sourceInventory,
) {
    const model = readJson(modelPath);
    const sampleData = readJson(sampleDataPath);
    if (model === undefined || sampleData === undefined) return false;
    try {
        const expected = buildProvisioningArtifacts(
            model,
            sampleData,
            project,
            readIdentityManifest(modelPath),
            sourceInventory,
        );
        return fs.readFileSync(filePath, 'utf8') === expected[artifactName];
    } catch {
        return false;
    }
}

function applicationDetailsComplete(project) {
    const analysis = project.phases?.discovery?.applicationAnalysis;
    return (
        analysis &&
        ['projectName', 'projectType', 'language', 'databaseType', 'databaseAccess', 'completedAt'].every(
            (key) => typeof analysis[key] === 'string' && analysis[key].trim().length > 0,
        ) &&
        (analysis.frameworks === undefined ||
            (Array.isArray(analysis.frameworks) &&
                analysis.frameworks.every(value => typeof value === 'string' && value.trim()))) &&
        Number.isFinite(Date.parse(analysis.completedAt))
    );
}

function phaseStatus(project, phase) {
    const statusByPhase = {
        preflight: project.phases?.discovery?.preflightStatus,
        discovery: project.phases?.discovery?.status,
        assessment: project.phases?.assessment?.status,
        'schema-conversion': project.phases?.schemaConversion?.status,
        provisioning: project.phases?.provisioning?.status,
        'code-migration': project.phases?.codeMigration?.status,
    };
    return statusByPhase[phase];
}

function missingMetadataArtifact(pathLabel, description) {
    return { path: pathLabel, description, conditional: false, state: 'missing' };
}

function addMetadataCheck(artifacts, pathLabel, description, present, valid) {
    artifacts.push({
        path: pathLabel,
        description,
        conditional: false,
        state: !present ? 'missing' : valid ? 'present' : 'invalid',
    });
}

function isWithinWorkspace(workspace, filePath) {
    const relative = path.relative(path.resolve(workspace), path.resolve(filePath));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isRealPathWithinWorkspace(workspace, filePath) {
    try {
        return isWithinWorkspace(fs.realpathSync(workspace), fs.realpathSync(filePath));
    } catch {
        return false;
    }
}

function isUtcIsoDateTime(value) {
    return (
        typeof value === 'string' &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString() === value
    );
}

const PREDECESSOR_PHASE = {
    discovery: 'preflight',
    assessment: 'discovery',
    'schema-conversion': 'assessment',
    provisioning: 'schema-conversion',
};

export function checkPhaseCompletion(workspace, phaseInput) {
    const result = checkPhase(workspace, phaseInput, true);
    if (result.phase === 'code-migration') {
        try {
            result.ready = checkCodeMigrationPrerequisites(workspace).complete;
        } catch {
            result.ready = false;
        }
    }
    return result;
}

export function checkCodeMigrationPrerequisites(workspace) {
    return checkPhase(workspace, 'schema-conversion', false);
}

function artifactCounts(artifacts) {
    return {
        total: artifacts.length,
        present: artifacts.filter(artifact => artifact.state === 'present').length,
        missing: artifacts.filter(artifact => artifact.state === 'missing').length,
        invalid: artifacts.filter(artifact => artifact.state === 'invalid').length,
    };
}

function omittedFailure(failure) {
    if (failure.kind === 'artifact') {
        const { diagnostics: _diagnostics, ...artifact } = failure.value;
        return { kind: failure.kind, value: { ...artifact, diagnosticsOmitted: 'exceeds output limit' } };
    }
    if (failure.kind === 'staleInput') {
        return { kind: failure.kind, value: { id: failure.value.id, reason: 'Diagnostic omitted: exceeds output limit' } };
    }
    return { kind: failure.kind, value: 'Diagnostic omitted: exceeds output limit' };
}

function compactResult(completion, failures, offset, limit, returned) {
    const nextOffset = offset + returned.length;
    const result = {
        phase: completion.phase,
        status: completion.status,
        complete: completion.complete,
        freshness: completion.freshness,
        ...(completion.ready === undefined ? {} : { ready: completion.ready }),
        artifactCounts: artifactCounts(completion.artifacts),
        staleInputCount: completion.staleInputs.length,
        errorCount: completion.errors.length,
        artifacts: returned.filter(failure => failure.kind === 'artifact').map(failure => failure.value),
        staleInputs: returned.filter(failure => failure.kind === 'staleInput').map(failure => failure.value),
        errors: returned.filter(failure => failure.kind === 'error').map(failure => failure.value),
        offset,
        limit,
        totalFailures: failures.length,
        returnedFailures: returned.length,
        truncated: offset > 0 || nextOffset < failures.length,
        ...(nextOffset < failures.length ? { nextOffset } : {}),
    };
    return result;
}

export function summarizePhaseCompletion(
    completion,
    { offset = 0, limit = DEFAULT_COMPLETION_PAGE_SIZE, artifactPath, maxOutputBytes = MAX_COMPLETION_OUTPUT_BYTES } = {},
) {
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Offset must be a non-negative integer.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be between 1 and 100.');
    const artifactFailures = completion.artifacts
        .filter(artifact => !artifact.conditional && artifact.state !== 'present')
        .filter(artifact => artifactPath === undefined || artifact.path === artifactPath)
        .map(value => ({ kind: 'artifact', value }));
    const failures = artifactPath === undefined
        ? [
              ...artifactFailures,
              ...completion.staleInputs.map(value => ({ kind: 'staleInput', value })),
              ...completion.errors.map(value => ({ kind: 'error', value })),
          ]
        : artifactFailures;
    const requested = failures.slice(offset, offset + limit);
    const returned = [];
    for (const failure of requested) {
        const candidate = compactResult(completion, failures, offset, limit, [...returned, failure]);
        if (Buffer.byteLength(`${JSON.stringify(candidate, null, 2)}\n`) <= maxOutputBytes) {
            returned.push(failure);
            continue;
        }
        const omitted = omittedFailure(failure);
        const fallback = compactResult(completion, failures, offset, limit, [...returned, omitted]);
        if (Buffer.byteLength(`${JSON.stringify(fallback, null, 2)}\n`) <= maxOutputBytes) returned.push(omitted);
        else break;
    }
    return compactResult(completion, failures, offset, limit, returned);
}

function checkPhase(workspace, phaseInput, checkFreshness) {
    const phase = normalizePhaseName(phaseInput);
    checkFreshness &&= phase !== 'code-migration';
    if (!phase) {
        return {
            phase: phaseInput,
            complete: false,
            status: undefined,
            freshness: 'unknown',
            staleInputs: [{ id: 'phase', reason: `Unknown phase: ${phaseInput}` }],
            artifacts: [],
            errors: [`Unknown phase: ${phaseInput}`],
        };
    }
    const migrationRoot = path.join(workspace, '.cosmosdb-migration');
    const projectPath = path.join(migrationRoot, 'project.json');
    const project = readJson(projectPath);
    if (!project) {
        return {
            phase,
            complete: false,
            status: undefined,
            freshness: 'unknown',
            staleInputs: [{ id: 'project', reason: 'project.json is missing or invalid' }],
            artifacts: [],
            errors: ['project.json is missing or invalid'],
        };
    }

    const projectErrors = validateMigrationProject(project);
    if (projectErrors.length > 0) {
        return {
            phase,
            complete: false,
            status: phaseStatus(project, phase),
            freshness: 'unknown',
            staleInputs: [{ id: 'project', reason: 'project.json is invalid' }],
            artifacts: [],
            errors: projectErrors.map((error) => `${error.path}: ${error.message}`),
        };
    }

    const artifacts = [];
    addArtifact(artifacts, workspace, projectPath, 'Migration project checkpoint', validateJson);
    let inventory;
    if (['preflight', 'discovery', 'assessment', 'schema-conversion', 'provisioning'].includes(phase)) {
        try { inventory = readSourceInventory(workspace, project, selectedDdlFiles(workspace, project)); }
        catch (error) { inventory = { errors: [{ path: 'resolved schema selection', message: error.message }] }; }
        if (inventory.errors.length) artifacts.push({ path: 'resolved schema selection', description: 'Recorded source inventory evidence', conditional: false, state: 'invalid', diagnostics: inventory.errors });
    }

    if (phase === 'preflight') {
        const ddlFiles = selectedDdlFiles(workspace, project);
        if (ddlFiles.length === 0) {
            artifacts.push(missingMetadataArtifact('resolved schema selection', 'At least one selected DDL file'));
        } else {
            for (const ddlFile of ddlFiles) {
                addArtifact(artifacts, workspace, ddlFile, 'Authoritative schema DDL', () => inventory.errors);
            }
        }
        if (!applicationDetailsComplete(project)) {
            artifacts.push(
                missingMetadataArtifact(
                    '.cosmosdb-migration/project.json#phases.discovery.applicationAnalysis',
                    'Complete application details',
                ),
            );
        }
        addArtifact(
            artifacts,
            workspace,
            path.join(migrationRoot, 'phases', '1-discovery', 'volumetrics', 'volumetrics.md'),
            'Reviewed volumetrics',
            validateVolumetrics,
        );
        addArtifact(
            artifacts,
            workspace,
            path.join(migrationRoot, 'phases', '1-discovery', 'access-patterns', 'access-patterns.md'),
            'Reviewed access patterns',
            validateAccessPatterns,
        );
        addArtifact(
            artifacts,
            workspace,
            path.join(migrationRoot, 'phases', '1-discovery', 'preflight-summary.md'),
            'Preflight summary and decisions',
            (filePath) => validateMarkdownFile(filePath, ['Summary', 'Warnings', 'Decisions']),
        );
        addArtifact(
            artifacts,
            workspace,
            path.join(migrationRoot, 'phases', '1-discovery', 'preflight-manifest.json'),
            'Preflight evidence manifest',
            (filePath) => validatePreflightManifest(filePath, inventory, workspace, project),
        );
        if (!inventory.errors.length) {
            const volumetricPath = path.join(migrationRoot, 'phases/1-discovery/volumetrics/volumetrics.md');
            const patternsPath = path.join(migrationRoot, 'phases/1-discovery/access-patterns/access-patterns.md');
            if (exists(volumetricPath) && exists(patternsPath)) {
                let comparisons;
                try {
                    comparisons = readPhaseEvidence(path.join(migrationRoot, 'phases/1-discovery/preflight-manifest.json')).comparisons;
                } catch { comparisons = []; }
                const errors = validateTemplates(fs.readFileSync(volumetricPath, 'utf8'), fs.readFileSync(patternsPath, 'utf8'), inventory, comparisons);
                if (errors.length) artifacts.push({ path: '.cosmosdb-migration/phases/1-discovery', description: 'Preflight consistency', conditional: false, state: 'invalid', diagnostics: errors });
            }
        }
    } else if (phase === 'discovery') {
        addArtifact(
            artifacts,
            workspace,
            path.join(migrationRoot, 'phases', '1-discovery', 'discovery-manifest.json'),
            'SDK compatibility report',
            (filePath) => validateSdkReport(filePath, project),
        );
        addArtifact(
            artifacts,
            workspace,
            path.join(migrationRoot, 'phases', '1-discovery', 'discovery-report.md'),
            'Discovery summary',
            (filePath) => validateMarkdownFile(filePath, ['Source Overview', 'Read Patterns', 'Write Patterns', 'Relational Semantics', 'Warnings']),
        );
        addArtifact(
            artifacts,
            workspace,
            path.join(migrationRoot, 'phases', '1-discovery', 'discovery-manifest.json'),
            'Discovery evidence manifest',
            filePath => inventory.errors.length ? inventory.errors : validateSourceReport(fs.readFileSync(path.join(path.dirname(filePath), 'discovery-report.md'), 'utf8'), readPhaseEvidence(filePath), inventory, 'discovery', [], checkFreshness ? workspace : undefined),
        );
    } else if (phase === 'assessment') {
        addArtifact(
            artifacts,
            workspace,
            path.join(migrationRoot, 'phases', '2-assessment', 'assessment-summary.md'),
            'Assessment summary',
            (filePath) => validateMarkdownFile(filePath, ['Overview', 'Domains', 'Cross-Domain Dependencies', 'Recommendations', 'Warnings']),
        );
        addArtifact(
            artifacts,
            workspace,
            path.join(migrationRoot, 'phases', '2-assessment', 'assessment-manifest.json'),
            'Assessment evidence manifest',
            filePath => inventory.errors.length ? inventory.errors : validateSourceReport(fs.readFileSync(path.join(path.dirname(filePath), 'assessment-summary.md'), 'utf8'), readPhaseEvidence(filePath), inventory, 'assessment', project.phases?.assessment?.domains ?? []),
        );
        const domains = project.phases?.assessment?.domains ?? [];
        if (domains.length === 0) {
            artifacts.push(
                missingMetadataArtifact(
                    '.cosmosdb-migration/project.json#phases.assessment.domains',
                    'Assessment domain metadata',
                ),
            );
        }
        for (const domain of domains) {
            addArtifact(
                artifacts,
                workspace,
                path.join(migrationRoot, 'phases', '2-assessment', 'domains', `${domain.name}.md`),
                `Assessment domain ${domain.name} summary`,
                (filePath) => validateMarkdownFile(filePath, ['Purpose', 'Tables', 'Access Patterns', 'Cross-Domain Dependencies']),
            );
            addArtifact(
                artifacts,
                workspace,
                path.join(migrationRoot, 'phases', '2-assessment', 'domains', `${domain.name}.manifest.json`),
                `Assessment domain ${domain.name} manifest`,
                filePath => {
                    const evidence = readPhaseEvidence(filePath);
                    return evidence.sourceSha256 === inventory.sha256 && evidence.domain === domain.name && JSON.stringify([...(evidence.tables ?? [])].sort()) === JSON.stringify([...domain.tables].sort());
                },
            );
        }
    } else if (phase === 'schema-conversion') {
        const conversionRoot = path.join(migrationRoot, 'phases/3-schema-conversion');
        const conversionDomains = project.phases?.schemaConversion?.domains ?? [];
        let expectedPatternIdsByDomain;
        let patternCoverageError;
        try {
            expectedPatternIdsByDomain = readExpectedPatternIdsByDomain(workspace, conversionDomains);
        } catch (error) {
            patternCoverageError = error;
        }
        const domainModels = (project.phases?.schemaConversion?.domains ?? []).map(domainName => {
            let model;
            try { model = readDomainModel(path.join(conversionRoot, 'domains', domainName, 'cosmos-model.json')); } catch { model = undefined; }
            return { domainName, model };
        });
        const referenceRegistry = domainModels.flatMap(({ domainName, model }) => (model?.containers ?? []).flatMap(container => (container.entities ?? []).map(entity => ({ domain: domainName, name: entity.name, sourceTable: entity.sourceTable }))));
        addArtifact(
            artifacts,
            workspace,
            path.join(migrationRoot, 'phases', '3-schema-conversion', 'model.json'),
            'Canonical root Cosmos DB model',
            validateModel,
        );
        addArtifact(
            artifacts,
            workspace,
            path.join(migrationRoot, 'phases', '3-schema-conversion', 'summary.md'),
            'Root schema conversion summary',
            (filePath) => validateConversionSummary(filePath, 'root'),
        );
        addArtifact(
            artifacts,
            workspace,
            path.join(migrationRoot, 'phases', '3-schema-conversion', 'manifest.json'),
            'Root schema conversion manifest',
            (filePath) => inventory.errors.length ? inventory.errors : validateConversionEvidence(project, inventory, domainModels, readJson(path.join(conversionRoot, 'model.json')), readPhaseEvidence(filePath)),
        );
        const domains = conversionDomains;
        if (domains.length === 0) {
            artifacts.push(
                missingMetadataArtifact(
                    '.cosmosdb-migration/project.json#phases.schemaConversion.domains',
                    'Schema conversion domain metadata',
                ),
            );
        }
        for (const domainName of domains) {
            const domainRoot = path.join(migrationRoot, 'phases', '3-schema-conversion', 'domains', domainName);
            addArtifact(
                artifacts,
                workspace,
                path.join(domainRoot, 'summary.md'),
                `Schema conversion summary for ${domainName}`,
                (filePath) => {
                    if (patternCoverageError) throw patternCoverageError;
                    return validateConversionSummary(
                        filePath,
                        'domain',
                        undefined,
                        path.join(domainRoot, 'cosmos-model.json'),
                        referenceRegistry,
                        expectedPatternIdsByDomain.get(domainName),
                    );
                },
            );
            addArtifact(
                artifacts,
                workspace,
                path.join(domainRoot, 'cosmos-model.json'),
                `Schema conversion manifest for ${domainName}`,
                (filePath) => validateDomainManifest(filePath, referenceRegistry),
            );
        }
    } else if (phase === 'provisioning') {
        const phaseRoot = path.join(migrationRoot, 'phases', '4-provisioning');
        const modelPath = path.join(migrationRoot, 'phases', '3-schema-conversion', 'model.json');
        const sampleDataPath = path.join(phaseRoot, 'sample-data.json');
        const verificationPath = path.join(phaseRoot, 'summary.md');
        const model = readJson(modelPath);
        const sampleData = readJson(sampleDataPath);
        const validModel = model !== undefined && validateCosmosModel(model).length === 0;
        addArtifact(artifacts, workspace, modelPath, 'Canonical root Cosmos DB model', validateModel);
        for (const [artifactName, description] of [
            ['main.bicep', 'Bicep deployment template'],
            ['main.bicepparam', 'Bicep parameters'],
            ['seed-data.csh', 'Seed script'],
        ]) {
            addArtifact(
                artifacts,
                workspace,
                path.join(phaseRoot, artifactName),
                description,
                (filePath) =>
                    validateGeneratedProvisioningArtifact(
                        filePath,
                        artifactName,
                        modelPath,
                        sampleDataPath,
                        project,
                        inventory,
                    ),
            );
        }
        addArtifact(
            artifacts,
            workspace,
            sampleDataPath,
            'Validated sample data',
            (filePath) => validateSampleDataFile(filePath, modelPath, inventory),
        );
        addArtifact(
            artifacts,
            workspace,
            verificationPath,
            'Provisioning summary',
            (filePath) => validateMarkdownFile(filePath, ['Summary', 'Target Verification', 'Warnings']),
        );
        addArtifact(
            artifacts,
            workspace,
            path.join(phaseRoot, 'manifest.json'),
            'Provisioning verification manifest',
            (filePath) => {
                const report = readPhaseEvidence(filePath).verification;
                return (
                    model !== undefined &&
                    sampleData !== undefined &&
                    report !== undefined &&
                    validateProvisioningVerification(
                        model,
                        sampleData,
                        project,
                        report,
                        readIdentityManifest(modelPath),
                        inventory,
                    )
                );
            },
        );
        const target = project.phases?.targetEnvironment;
        const provisioning = project.phases?.provisioning;
        addMetadataCheck(
            artifacts,
            '.cosmosdb-migration/project.json#phases.targetEnvironment.verified',
            'Verified target environment',
            target?.verified !== undefined,
            target?.verified === true && typeof target.verifiedAt === 'string' && target.verifiedAt.length > 0,
        );
        addMetadataCheck(
            artifacts,
            '.cosmosdb-migration/project.json#phases.provisioning.databaseName',
            'Provisioned database metadata',
            provisioning?.databaseName !== undefined,
            typeof provisioning?.databaseName === 'string' && provisioning.databaseName === model?.databaseName,
        );
        const expectedContainers = validModel ? model.containers.map((container) => container.name).sort() : undefined;
        const actualContainers = Array.isArray(provisioning?.containersCreated)
            ? [...provisioning.containersCreated].sort()
            : undefined;
        addMetadataCheck(
            artifacts,
            '.cosmosdb-migration/project.json#phases.provisioning.containersCreated',
            'Provisioned container metadata',
            actualContainers !== undefined,
            actualContainers !== undefined &&
                expectedContainers !== undefined &&
                JSON.stringify(actualContainers) === JSON.stringify(expectedContainers),
        );
        addMetadataCheck(
            artifacts,
            '.cosmosdb-migration/project.json#phases.provisioning.sampleDataInserted',
            'Sample data insertion metadata',
            provisioning?.sampleDataInserted !== undefined,
            provisioning?.sampleDataInserted === true,
        );
        addMetadataCheck(
            artifacts,
            '.cosmosdb-migration/project.json#phases.provisioning.completedAt',
            'Provisioning completion timestamp',
            provisioning?.completedAt !== undefined,
            typeof provisioning?.completedAt === 'string' && provisioning.completedAt.length > 0,
        );
        for (const artifactPath of project.phases?.provisioning?.artifactPaths ?? []) {
            const resolvedArtifactPath = path.resolve(workspace, artifactPath);
            if (!isWithinWorkspace(workspace, resolvedArtifactPath)) {
                artifacts.push({
                    path: artifactPath,
                    description: 'Target-specific provisioning artifact',
                    conditional: false,
                    state: 'invalid',
                });
                continue;
            }
            addArtifact(
                artifacts,
                workspace,
                resolvedArtifactPath,
                'Target-specific provisioning artifact',
            );
        }
    } else if (phase === 'code-migration') {
        const configuredPlanPath = project.phases?.codeMigration?.planPath;
        const planPath = configuredPlanPath ? path.resolve(workspace, configuredPlanPath) : undefined;
        const expectedPlanPath = path.normalize('.cosmosdb-migration/code-migration-plan.md');
        const validPlanPath =
            configuredPlanPath !== undefined &&
            !path.isAbsolute(configuredPlanPath) &&
            path.normalize(configuredPlanPath) === expectedPlanPath &&
            planPath !== undefined &&
            isWithinWorkspace(workspace, planPath) &&
            (!fs.existsSync(planPath) || isRealPathWithinWorkspace(workspace, planPath));
        addMetadataCheck(
            artifacts,
            '.cosmosdb-migration/project.json#phases.codeMigration.planPath',
            'Code migration plan path',
            configuredPlanPath !== undefined,
            validPlanPath,
        );
        if (validPlanPath) {
            const manifestPath = path.join(path.dirname(planPath), 'code-migration-manifest.json');
            addArtifact(
                artifacts,
                workspace,
                planPath,
                'Application code migration summary',
                (filePath) =>
                    validateCodeMigrationRecord(
                        fs.readFileSync(filePath, 'utf8'),
                        JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
                        { workspace, project },
                    ),
            );
            addArtifact(artifacts, workspace, manifestPath, 'Application code migration manifest', validateJson);
        }
        addMetadataCheck(
            artifacts,
            '.cosmosdb-migration/project.json#phases.codeMigration.completedAt',
            'Code migration completion timestamp',
            project.phases?.codeMigration?.completedAt !== undefined,
            isUtcIsoDateTime(project.phases?.codeMigration?.completedAt),
        );
    }

    const ownFreshness = checkFreshness
        ? validateFreshnessManifest(workspace, project, phase, project.freshness?.[phase])
        : { freshness: 'not-applicable', staleInputs: [] };
    const predecessorPhase = PREDECESSOR_PHASE[phase];
    const predecessor = predecessorPhase ? checkPhase(workspace, predecessorPhase, checkFreshness) : undefined;
    const staleInputs = [...ownFreshness.staleInputs];
    if (predecessor && !predecessor.complete) {
        artifacts.push({
            path: `.cosmosdb-migration/project.json#${predecessorPhase}`,
            description: `Required predecessor ${predecessorPhase}`,
            conditional: false,
            state: 'invalid',
            diagnostics: predecessor.errors,
        });
        if (checkFreshness) staleInputs.push({
            id: `predecessor:${predecessorPhase}`,
            reason: `required predecessor ${predecessorPhase} is not current and complete`,
        });
    }
    const freshness = staleInputs.length
        ? ownFreshness.freshness === 'unknown'
            ? 'unknown'
            : 'stale'
        : ownFreshness.freshness;
    const status = phaseStatus(project, phase);
    const incompleteArtifacts = artifacts.filter(
        (artifact) => !artifact.conditional && artifact.state !== 'present',
    );
    return {
        phase,
        status,
        complete: status === 'complete' && incompleteArtifacts.length === 0 && (!checkFreshness || freshness === 'current'),
        freshness,
        staleInputs,
        artifacts,
        errors:
            status === 'complete' && (incompleteArtifacts.length > 0 || (checkFreshness && freshness !== 'current'))
                ? [
                      incompleteArtifacts.length > 0
                          ? 'project status is complete but required artifacts are missing or invalid'
                          : 'project status is complete but required inputs are stale or have unknown freshness',
                  ]
                : [],
    };
}

function parseArguments(argv) {
    let workspace = process.cwd();
    let phase;
    let offset = 0;
    let limit = DEFAULT_COMPLETION_PAGE_SIZE;
    let artifactPath;
    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === '--workspace') workspace = path.resolve(requireOptionValue(argv, index++));
        else if (argv[index] === '--phase') phase = requireOptionValue(argv, index++);
        else if (argv[index] === '--offset') offset = Number(requireOptionValue(argv, index++));
        else if (argv[index] === '--limit') limit = Number(requireOptionValue(argv, index++));
        else if (argv[index] === '--artifact') artifactPath = requireOptionValue(argv, index++);
        else throw new Error(`Unexpected argument: ${argv[index]}`);
    }
    if (!phase) {
        throw new Error(
            'Usage: check-phase-completion.mjs [--workspace <path>] --phase <preflight|discovery|assessment|schema-conversion|provisioning|code-migration> [--offset <number>] [--limit <number>] [--artifact <path>]',
        );
    }
    return { workspace, phase, offset, limit, artifactPath };
}

export function runCli(argv) {
        if (showHelp(argv, `
Usage: node check-phase-completion.mjs --phase <name> [options]

Read-only authoritative completion gate; checks project state and required artifacts.
Outputs bounded JSON. Pagination and filtering never narrow validation or exit status.

    --workspace <path>  Application root; default current working directory.
    --phase <name>      Required: preflight, discovery, assessment, schema-conversion,
                                         provisioning, or code-migration.
    --offset <n>        Diagnostic offset; default 0.
    --limit <n>         Page size from 1 to 100; default ${DEFAULT_COMPLETION_PAGE_SIZE}.
    --artifact <path>   Workspace-relative artifact diagnostic filter.

Reuse an unchanged inspector completion result instead of immediately repeating this check.
Run again after relevant writes before reporting completion.
Exit: 0 only when complete; 1 when incomplete, invalid, stale, or inspection fails.
`)) return 0;
    try {
        const { workspace, phase, offset, limit, artifactPath } = parseArguments(argv);
        const result = checkPhaseCompletion(workspace, phase);
        process.stdout.write(`${JSON.stringify(summarizePhaseCompletion(result, { offset, limit, artifactPath }), null, 2)}\n`);
        return result.complete ? 0 : 1;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 1;
    }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli(process.argv.slice(2));
