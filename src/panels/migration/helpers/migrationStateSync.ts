/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import * as path from 'path';
import { type MigrationExecution } from '../../../webviews/cosmosdb/Migration/state/deriveMigrationPhaseStates';

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
    freshness: 'current' | 'stale' | 'unknown' | 'not-applicable';
    ready?: boolean;
    staleInputs: { id: string; reason: string }[];
    artifacts: {
        path: string;
        description: string;
        conditional: boolean;
        state: 'missing' | 'present' | 'invalid';
    }[];
    errors: string[];
}

export type MigrationPhaseCompletionMap = Record<MigrationPhaseName, MigrationPhaseCompletion>;

interface MigrationCompletionCheckerModule {
    checkPhaseCompletion(workspace: string, phase: MigrationPhaseName): MigrationPhaseCompletion;
}

export function safeCheckPhaseCompletion(
    checker: MigrationCompletionCheckerModule,
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
): Promise<MigrationPhaseCompletionMap> {
    const checkerPath = path.join(
        extensionPath,
        'skills',
        'cosmosdb-relational-migration',
        'scripts',
        'check-phase-completion.mjs',
    );
    const checker = (await import(
        /* @vite-ignore */ pathToFileURL(checkerPath).href
    )) as MigrationCompletionCheckerModule;

    return Object.fromEntries(
        migrationPhaseNames.map((phase) => [phase, safeCheckPhaseCompletion(checker, workspacePath, phase)]),
    ) as MigrationPhaseCompletionMap;
}
