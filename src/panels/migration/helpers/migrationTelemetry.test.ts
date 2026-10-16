/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { describe, expect, it } from 'vitest';
import { type ProjectJson } from '../../../services/MigrationProjectService';
import { extractAccountNameFromEndpoint, setMigrationTelemetryContext } from './migrationTelemetry';

function createContext() {
    return {
        telemetry: {
            properties: {} as Record<string, string | undefined>,
            measurements: {} as Record<string, number | undefined>,
        },
        errorHandling: {
            issueProperties: {} as Record<string, string>,
            forceIncludeInReportIssueCommand: undefined as boolean | undefined,
        },
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
    };
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

describe('setMigrationTelemetryContext — context stamping', () => {
    it('is a no-op when no project is provided', () => {
        const ctx = createContext();
        setMigrationTelemetryContext(ctx as unknown as IActionContext, undefined);
        expect(ctx.telemetry.properties).toEqual({});
        expect(ctx.telemetry.measurements).toEqual({});
        expect(ctx.valuesToMask).toEqual([]);
    });

    it('stamps sessionId, phase, hasCustomInstructions and sourceDbType', () => {
        const ctx = createContext();
        const project = createProject({
            phases: {
                discovery: {
                    status: 'not-started',
                    discoveryInstructions: 'be careful',
                    applicationAnalysis: { databaseType: 'PostgreSQL' },
                },
            },
        });
        setMigrationTelemetryContext(ctx as unknown as IActionContext, project, 'discovery');
        expect(ctx.telemetry.properties.sessionId).toBe('session-guid');
        expect(ctx.telemetry.properties.phase).toBe('discovery');
        expect(ctx.telemetry.properties.hasCustomInstructions).toBe('true');
        expect(ctx.telemetry.properties.sourceDbType).toBe('PostgreSQL');
        expect(ctx.errorHandling.issueProperties.sessionId).toBe('session-guid');
        expect(ctx.errorHandling.issueProperties.phase).toBe('discovery');
    });

    it('reports hasCustomInstructions=false when the phase has no instructions', () => {
        const ctx = createContext();
        setMigrationTelemetryContext(ctx as unknown as IActionContext, createProject(), 'discovery');
        expect(ctx.telemetry.properties.hasCustomInstructions).toBe('false');
    });

    it('stamps migrationMode when set', () => {
        const ctx = createContext();
        setMigrationTelemetryContext(ctx as unknown as IActionContext, createProject({ migrationMode: 'start' }));
        expect(ctx.telemetry.properties.migrationMode).toBe('start');
    });

    it('masks OII identifiers from error messages without emitting them as properties', () => {
        const ctx = createContext();
        const project = createProject({
            phases: {
                discovery: { status: 'not-started' },
                targetEnvironment: {
                    type: 'azure',
                    tenantId: 'tenant-1',
                    subscriptionId: 'sub-1',
                    accountName: 'my-account',
                    resourceGroup: 'my-rg',
                },
            },
        });
        setMigrationTelemetryContext(ctx as unknown as IActionContext, project, 'provisioning');
        expect(ctx.valuesToMask).toEqual(expect.arrayContaining(['tenant-1', 'sub-1', 'my-account', 'my-rg']));
        // None of these OII values should be emitted as telemetry properties here.
        const props = Object.values(ctx.telemetry.properties);
        expect(props).not.toContain('tenant-1');
        expect(props).not.toContain('sub-1');
        expect(props).not.toContain('my-rg');
    });
});

describe('extractAccountNameFromEndpoint', () => {
    it('returns the first subdomain of a Cosmos endpoint', () => {
        expect(extractAccountNameFromEndpoint('https://myaccount.documents.azure.com:443/')).toBe('myaccount');
    });

    it('returns the hostname when there is no dot', () => {
        expect(extractAccountNameFromEndpoint('http://localhost:8081/')).toBe('localhost');
    });

    it('returns undefined for an unparseable endpoint', () => {
        expect(extractAccountNameFromEndpoint('not a url')).toBeUndefined();
    });
});
