/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { readFile, realpath, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import * as path from 'path';
import { type ProjectJson } from '../../../services/MigrationProjectService';
import {
    type MigrationExecution,
    type MigrationFreshnessCause,
} from '../../../webviews/cosmosdb/Migration/state/deriveMigrationPhaseStates';

export function toMigrationProjectView(project: ProjectJson) {
    const discovery = project.phases.discovery;
    const analysis = discovery.applicationAnalysis;
    const target = project.phases.targetEnvironment;
    return {
        name: project.name,
        migrationInstructions: project.migrationInstructions,
        phases: {
            discovery: {
                discoveryInstructions: discovery.discoveryInstructions,
                applicationAnalysis:
                    analysis && typeof analysis === 'object' && !Array.isArray(analysis)
                        ? {
                              projectName: analysis.projectName,
                              projectType: analysis.projectType,
                              language: analysis.language,
                              frameworks: Array.isArray(analysis.frameworks)
                                  ? analysis.frameworks.filter((framework) => typeof framework === 'string')
                                  : undefined,
                              databaseType: analysis.databaseType,
                              databaseAccess: analysis.databaseAccess,
                          }
                        : undefined,
            },
            assessment: project.phases.assessment
                ? { assessmentInstructions: project.phases.assessment.assessmentInstructions }
                : undefined,
            schemaConversion: project.phases.schemaConversion
                ? { schemaConversionInstructions: project.phases.schemaConversion.schemaConversionInstructions }
                : undefined,
            targetEnvironment: target
                ? {
                      type: target.type,
                      endpoint: target.endpoint,
                      accountName: target.accountName,
                      subscriptionId: target.subscriptionId,
                      subscriptionName: target.subscriptionName,
                      resourceGroup: target.resourceGroup,
                      location: target.location,
                      verified: target.verified,
                  }
                : undefined,
        },
    };
}

export type MigrationProjectView = ReturnType<typeof toMigrationProjectView>;

export async function readMigrationExecution(
    extensionPath: string,
    workspacePath: string,
): Promise<MigrationExecution | undefined> {
    let content: string;
    try {
        content = await readFile(path.join(workspacePath, '.cosmosdb-migration', 'project.json'), 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
    const project = JSON.parse(content) as { execution?: MigrationExecution };
    const validatorPath = path.join(
        extensionPath,
        'skills',
        'cosmosdb-relational-migration',
        'scripts',
        'validate-migration-project.mjs',
    );
    const validator = (await import(/* @vite-ignore */ pathToFileURL(validatorPath).href)) as {
        validateMigrationExecution(value: unknown): { path: string; message: string }[];
    };
    const errors = validator.validateMigrationExecution(project?.execution);
    if (errors.length) throw new Error(errors.map((error) => `${error.path}: ${error.message}`).join('; '));
    return project?.execution;
}

export const migrationPhaseNames = [
    'preflight',
    'discovery',
    'assessment',
    'schema-conversion',
    'provisioning',
    'code-migration',
] as const;

export type MigrationPhaseName = (typeof migrationPhaseNames)[number];

export interface MigrationPhaseCompletion {
    phase: MigrationPhaseName;
    status: 'not-started' | 'in-progress' | 'complete' | undefined;
    complete: boolean;
    compatibilityChanges?: string[];
    recordedCompletedAt?: string;
    freshness: 'current' | 'stale' | 'unknown' | 'not-applicable';
    ready?: boolean;
    staleInputs: { id: string; reason: string; path?: string }[];
    freshnessCauses?: MigrationFreshnessCause[];
    artifacts: {
        path: string;
        description: string;
        conditional: boolean;
        state: 'missing' | 'present' | 'invalid';
        diagnostics?: (string | { path?: string; code?: string; message: string })[];
        canOpen?: boolean;
    }[];
    errors: string[];
}

export type MigrationPhaseCompletionMap = Record<MigrationPhaseName, MigrationPhaseCompletion>;

async function addArtifactAccess(
    completion: MigrationPhaseCompletionMap,
    workspacePath: string,
): Promise<MigrationPhaseCompletionMap> {
    const root = await realpath(workspacePath).catch(() => undefined);
    const access = new Map<string, Promise<boolean>>();
    await Promise.all(
        Object.values(completion).flatMap((phase) =>
            [...phase.artifacts, ...(phase.freshnessCauses ?? [])].map(async (artifact) => {
                if (!root || !artifact.path || ('state' in artifact && artifact.state === 'missing')) {
                    artifact.canOpen = false;
                    return;
                }
                const artifactPath = artifact.path.split('#')[0];
                let check = access.get(artifactPath);
                if (!check) {
                    check = (async () => {
                        try {
                            const resolved = await realpath(path.resolve(root, artifactPath));
                            const relative = path.relative(root, resolved);
                            return (
                                relative !== '..' &&
                                !relative.startsWith(`..${path.sep}`) &&
                                !path.isAbsolute(relative) &&
                                (await stat(resolved)).isFile()
                            );
                        } catch {
                            return false;
                        }
                    })();
                    access.set(artifactPath, check);
                }
                artifact.canOpen = await check;
            }),
        ),
    );
    return completion;
}

interface MigrationCompletionCheckerModule {
    checkPhaseCompletion(workspace: string, phase: MigrationPhaseName): MigrationPhaseCompletion;
    checkPhaseCompletions(workspace: string, phases: readonly MigrationPhaseName[]): MigrationPhaseCompletionMap;
}

export function safeCheckPhaseCompletion(
    checker: Pick<MigrationCompletionCheckerModule, 'checkPhaseCompletion'>,
    workspacePath: string,
    phase: MigrationPhaseName,
): MigrationPhaseCompletion {
    try {
        return checker.checkPhaseCompletion(workspacePath, phase);
    } catch (error) {
        return {
            phase,
            status: undefined,
            complete: false,
            freshness: 'unknown',
            staleInputs: [{ id: 'completion-check', reason: 'Completion checker failed unexpectedly' }],
            artifacts: [],
            errors: [`Completion check failed: ${error instanceof Error ? error.message : String(error)}`],
        };
    }
}

export async function readMigrationPhaseCompletion(
    extensionPath: string,
    workspacePath: string,
    signal?: AbortSignal,
): Promise<MigrationPhaseCompletionMap> {
    signal?.throwIfAborted();
    try {
        await stat(path.join(workspacePath, '.cosmosdb-migration'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        signal?.throwIfAborted();
        return Object.fromEntries(
            migrationPhaseNames.map((phase): [MigrationPhaseName, MigrationPhaseCompletion] => [
                phase,
                {
                    phase,
                    status: 'not-started',
                    complete: false,
                    freshness: 'not-applicable',
                    staleInputs: [],
                    artifacts: [],
                    errors: [],
                },
            ]),
        ) as MigrationPhaseCompletionMap;
    }
    signal?.throwIfAborted();
    const checkerPath = path.join(
        extensionPath,
        'skills',
        'cosmosdb-relational-migration',
        'scripts',
        'check-phase-completion.mjs',
    );
    return new Promise((resolve, reject) => {
        const worker = new Worker(
            `const { parentPort, workerData } = require('node:worker_threads');
             process.argv = [process.execPath];
             import(workerData.checkerUrl).then(checker => {
                 parentPort.postMessage(checker.checkPhaseCompletions(workerData.workspacePath, workerData.phases));
             });`,
            {
                eval: true,
                execArgv: [],
                workerData: {
                    checkerUrl: pathToFileURL(checkerPath).href,
                    workspacePath,
                    phases: migrationPhaseNames,
                },
            },
        );
        let completion: MigrationPhaseCompletionMap | undefined;
        let failure: Error | undefined;
        const abort = () => void worker.terminate();
        signal?.addEventListener('abort', abort, { once: true });
        worker.once('message', (result: MigrationPhaseCompletionMap) => {
            completion = result;
        });
        worker.once('error', (error) => {
            failure = error instanceof Error ? error : new Error(String(error));
        });
        worker.once('exit', (code) => {
            signal?.removeEventListener('abort', abort);
            if (signal?.aborted) {
                reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
            } else if (failure) reject(failure);
            else if (code !== 0 || !completion) {
                reject(new Error(l10n.t('Migration completion check exited without a result (code {0}).', code)));
            } else resolve(addArtifactAccess(completion, workspacePath));
        });
    });
}
