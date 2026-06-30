/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { describe, expect, it } from 'vitest';
import { type ProjectJson } from '../../../services/MigrationProjectService';
import { setMigrationTelemetryContext } from './migrationTelemetry';

function createContext() {
    return {
        telemetry: {
            properties: {} as Record<string, string | undefined>,
            measurements: {} as Record<string, number | undefined>,
        },
        errorHandling: { issueProperties: {} as Record<string, string> },
        valuesToMask: [] as string[],
    };
}

function createProject(overrides?: Partial<ProjectJson>): ProjectJson {
    return {
        version: 1,
        name: 'test',
        sourceCode: 'parent',
        sessionId: 'session-guid',
        runCounts: {},
        phases: { discovery: { status: 'not-started' } },
        ...overrides,
    } as ProjectJson;
}

describe('setMigrationTelemetryContext — runIndex baseline', () => {
    it('stamps runIndex 0 on the first run of a phase', () => {
        const ctx = createContext();
        setMigrationTelemetryContext(ctx as unknown as IActionContext, createProject(), 'discovery');
        expect(ctx.telemetry.measurements.runIndex).toBe(0);
    });

    it('stamps the prior run count on re-runs', () => {
        const ctx = createContext();
        setMigrationTelemetryContext(
            ctx as unknown as IActionContext,
            createProject({ runCounts: { schemaConversion: 2 } }),
            'schemaConversion',
        );
        expect(ctx.telemetry.measurements.runIndex).toBe(2);
    });

    it('does not stamp runIndex when no phase is provided', () => {
        const ctx = createContext();
        setMigrationTelemetryContext(ctx as unknown as IActionContext, createProject());
        expect(ctx.telemetry.measurements.runIndex).toBeUndefined();
    });
});
