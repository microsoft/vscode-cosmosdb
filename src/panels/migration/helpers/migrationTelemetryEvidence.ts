/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { type ProjectJson } from '../../../services/MigrationProjectService';
import { type MigrationSkillInvocation } from './migrationSkillDispatcher';
import { type MigrationPhaseCompletion, type MigrationPhaseCompletionMap } from './migrationStateSync';

export interface MigrationTelemetryEvidence {
    validation: 'passed' | 'failed' | 'unavailable';
    measurements: Record<string, number>;
    errorCategory?: 'validation' | 'evidenceRead' | 'completionCheck';
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid evidence object');
    return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new Error('Invalid evidence array');
    return value;
}

async function readJson(filePath: string, measurements: Record<string, number>): Promise<Record<string, unknown>> {
    const content = await readFile(filePath, 'utf8');
    const result = record(JSON.parse(content));
    measurements.artifactBytes = (measurements.artifactBytes ?? 0) + Buffer.byteLength(content, 'utf8');
    return result;
}

function artifactPresent(completion: MigrationPhaseCompletion, artifactPath: string): boolean {
    return completion.artifacts.some((artifact) => artifact.path === artifactPath && artifact.state === 'present');
}

function scopeValid(invocation: MigrationSkillInvocation, completion: MigrationPhaseCompletion): boolean {
    if (!artifactPresent(completion, '.cosmosdb-migration/project.json')) return false;
    switch (invocation.preflightStep) {
        case 'application-details':
            // The checker emits this metadata artifact only when application details are incomplete.
            return !completion.artifacts.some(
                (artifact) => artifact.path === '.cosmosdb-migration/project.json#phases.discovery.applicationAnalysis',
            );
        case 'schema-acquisition': {
            const schema = completion.artifacts.filter(
                (artifact) => artifact.description === 'Authoritative schema DDL',
            );
            return schema.length > 0 && schema.every((artifact) => artifact.state === 'present');
        }
        case 'volumetrics':
        case 'access-patterns':
            return (
                !completion.artifacts.some(
                    (artifact) => artifact.description === 'Preflight consistency' && artifact.state !== 'present',
                ) &&
                artifactPresent(
                    completion,
                    `.cosmosdb-migration/phases/1-discovery/${invocation.preflightStep}/${invocation.preflightStep}.md`,
                )
            );
    }
    if (invocation.provisioningStep === 'target-account') {
        return artifactPresent(completion, '.cosmosdb-migration/project.json#phases.targetEnvironment.verified');
    }
    return completion.complete && (completion.freshness === 'current' || completion.phase === 'code-migration');
}

/** Collects validated structural aggregates locally; no file contents, paths, or names are emitted. */
export async function collectMigrationTelemetryEvidence(
    invocation: MigrationSkillInvocation,
    project: ProjectJson,
    completions: MigrationPhaseCompletionMap,
): Promise<MigrationTelemetryEvidence> {
    const phase = invocation.phase;
    if (!phase) return { validation: 'unavailable', measurements: {} };
    const completion = completions[phase];
    if (completion.staleInputs.some((input) => input.id === 'completion-check')) {
        return { validation: 'unavailable', measurements: {}, errorCategory: 'completionCheck' };
    }
    const measurements: Record<string, number> = {
        missingArtifactCount: completion.artifacts.filter((artifact) => artifact.state === 'missing').length,
        invalidArtifactCount: completion.artifacts.filter((artifact) => artifact.state === 'invalid').length,
        staleInputCount: completion.staleInputs.length,
    };
    if (!scopeValid(invocation, completion)) {
        return { validation: 'failed', measurements, errorCategory: 'validation' };
    }
    try {
        const root = path.join(invocation.workspacePath, '.cosmosdb-migration');
        if (phase === 'code-migration') {
            const manifest = await readJson(path.join(root, 'code-migration-manifest.json'), measurements);
            if (manifest.mode !== (invocation.codeMigrationAction ?? 'plan')) {
                return { validation: 'failed', measurements, errorCategory: 'validation' };
            }
        }
        if ((phase === 'preflight' && !invocation.preflightStep) || phase === 'discovery') {
            const manifest = await readJson(
                path.join(root, 'phases/1-discovery/preflight-manifest.json'),
                measurements,
            );
            const inventory = record(manifest.sourceInventory);
            const tables = array(inventory.tables);
            measurements.schemaFileCount = array(inventory.files).length;
            measurements.sourceInventoryTableCount = tables.length;
            measurements.sourceColumnCount = tables.reduce<number>(
                (sum, table) => sum + array(record(table).columns).length,
                0,
            );
            measurements.sourceForeignKeyCount = tables.reduce<number>(
                (sum, table) => sum + array(record(table).foreignKeys).length,
                0,
            );
        }
        if (phase === 'assessment') {
            measurements.domainCount = project.phases.assessment?.domains?.length ?? 0;
            measurements.accessPatternCount = project.phases.assessment?.parsedAccessPatterns?.length ?? 0;
        }
        if (phase === 'schema-conversion') {
            const domains = project.phases.schemaConversion?.domains ?? [];
            measurements.domainCount = domains.length;
            measurements.skippedDomainCount = Math.max(
                0,
                (project.phases.assessment?.domains?.length ?? 0) - domains.length,
            );
            // Read only paths already checked as workspace-local artifacts, not arbitrary project paths.
            const models = completion.artifacts.filter(
                (artifact) =>
                    artifact.path.endsWith('/cosmos-model.json') && artifact.state === 'present' && artifact.canOpen,
            );
            if (models.length !== domains.length) throw new Error('Domain evidence unavailable');
            let containerCount = 0;
            for (const model of models) {
                const content = await readJson(path.resolve(invocation.workspacePath, model.path), measurements);
                containerCount += array(content.containers).length;
            }
            measurements.targetContainerCount = containerCount;
        }
        if (phase === 'provisioning' && invocation.provisioningStep !== 'target-account') {
            // Existing metadata proves presence, not which containers this invocation created.
            measurements.verifiedContainerCount = project.phases.provisioning?.containersCreated?.length ?? 0;
        }
        return { validation: 'passed', measurements };
    } catch {
        // Evidence can disappear or become invalid after the completion worker's snapshot.
        return { validation: 'unavailable', measurements: {}, errorCategory: 'evidenceRead' };
    }
}
