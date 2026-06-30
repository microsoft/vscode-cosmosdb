/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { type ProjectJson } from '../../../services/MigrationProjectService';
import { type ExtractionStats } from '../../../utils/ddlExtractor';
import {
    enrichErrorContext,
    extractAccountNameFromEndpoint,
    incrementRunCount,
    reportDdlExtractorStats,
    setAiTelemetryContext,
    setMigrationTelemetryContext,
} from './migrationTelemetry';

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

describe('incrementRunCount', () => {
    it('returns 1 on the first run and initializes runCounts', () => {
        const project = createProject({ runCounts: undefined });
        expect(incrementRunCount(project, 'discovery')).toBe(1);
        expect(project.runCounts?.discovery).toBe(1);
    });

    it('increments an existing count', () => {
        const project = createProject({ runCounts: { assessment: 2 } });
        expect(incrementRunCount(project, 'assessment')).toBe(3);
        expect(project.runCounts?.assessment).toBe(3);
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

describe('setAiTelemetryContext', () => {
    it('stamps model id, family and vendor', () => {
        const ctx = createContext();
        setAiTelemetryContext(
            ctx as unknown as IActionContext,
            {
                id: 'gpt-x',
                family: 'gpt',
                vendor: 'copilot',
            } as unknown as vscode.LanguageModelChat,
        );
        expect(ctx.telemetry.properties.modelId).toBe('gpt-x');
        expect(ctx.telemetry.properties.modelFamily).toBe('gpt');
        expect(ctx.telemetry.properties.modelVendor).toBe('copilot');
    });
});

describe('enrichErrorContext', () => {
    it('is a no-op for cancellation errors', () => {
        const ctx = createContext();
        enrichErrorContext(ctx as unknown as IActionContext, new vscode.CancellationError());
        expect(ctx.telemetry.properties.errorCategory).toBeUndefined();
        expect(ctx.errorHandling.forceIncludeInReportIssueCommand).toBeUndefined();
    });

    it('classifies generic errors as infrastructure', () => {
        const ctx = createContext();
        enrichErrorContext(ctx as unknown as IActionContext, new Error('disk full'));
        expect(ctx.telemetry.properties.errorCategory).toBe('infrastructure');
        expect(ctx.errorHandling.issueProperties.errorCategory).toBe('infrastructure');
        expect(ctx.errorHandling.forceIncludeInReportIssueCommand).toBe(true);
    });

    it('classifies LanguageModelError as ai and records the code', () => {
        const ctx = createContext();
        enrichErrorContext(ctx as unknown as IActionContext, new vscode.LanguageModelError('blocked', 'Blocked'));
        expect(ctx.telemetry.properties.errorCategory).toBe('ai');
        expect(ctx.telemetry.properties.aiErrorCode).toBe('Blocked');
        expect(ctx.errorHandling.issueProperties.aiErrorCode).toBe('Blocked');
    });

    it('records a bounded cause type and code for Unknown AI errors', () => {
        const ctx = createContext();
        const cause = Object.assign(new TypeError('boom'), { code: 'ECONNRESET' });
        enrichErrorContext(
            ctx as unknown as IActionContext,
            new vscode.LanguageModelError('wrapped', 'Unknown', cause),
        );
        expect(ctx.telemetry.properties.aiErrorCauseType).toBe('TypeError');
        expect(ctx.telemetry.properties.aiErrorCauseCode).toBe('ECONNRESET');
    });

    it('drops a cause code that contains PII-like characters (allowlist enforced)', () => {
        const ctx = createContext();
        const cause = Object.assign(new Error('x'), { code: '/Users/alice/secret path' });
        enrichErrorContext(
            ctx as unknown as IActionContext,
            new vscode.LanguageModelError('wrapped', 'Unknown', cause),
        );
        // The cause type is bounded and safe...
        expect(ctx.telemetry.properties.aiErrorCauseType).toBe('Error');
        // ...but the unbounded code must be rejected by the regex allowlist.
        expect(ctx.telemetry.properties.aiErrorCauseCode).toBeUndefined();
    });

    it('never stores the raw cause message', () => {
        const ctx = createContext();
        const cause = new Error('user@example.com /secret/path');
        enrichErrorContext(
            ctx as unknown as IActionContext,
            new vscode.LanguageModelError('wrapped', 'Unknown', cause),
        );
        const allValues = [
            ...Object.values(ctx.telemetry.properties),
            ...Object.values(ctx.errorHandling.issueProperties),
        ];
        expect(allValues).not.toContain('user@example.com /secret/path');
    });

    it('copies model info into issueProperties', () => {
        const ctx = createContext();
        ctx.telemetry.properties.modelId = 'gpt-x';
        ctx.telemetry.properties.modelFamily = 'gpt';
        enrichErrorContext(ctx as unknown as IActionContext, new Error('infra'));
        expect(ctx.errorHandling.issueProperties.modelId).toBe('gpt-x');
        expect(ctx.errorHandling.issueProperties.modelFamily).toBe('gpt');
    });
});

describe('reportDdlExtractorStats', () => {
    function makeStats(): ExtractionStats {
        return {
            inputChars: 100,
            outputChars: 60,
            reductionRatio: 0.4,
            durationMs: 5,
            warnings: ['w1'],
            statementCounts: {
                createTable: 2,
                alterTable: 1,
                createIndex: 3,
                createFulltextIndex: 0,
                createView: 0,
                createSequence: 0,
                createType: 0,
                createDomain: 0,
                createSchema: 0,
                other: 0,
            },
            drops: { alterTableCheckReenable: 0, alterTableCheckConstraint: 0 },
            strips: {
                withOptionBlocks: 0,
                inlineCheckConstraints: 0,
                onPrimary: 0,
                textImageOn: 0,
                fileStreamOn: 0,
                collate: 0,
                rowGuidCol: 0,
                notForReplication: 0,
            },
            views: { summarized: 0, referencedTablesTotal: 0 },
        } as unknown as ExtractionStats;
    }

    it('records structural measurements on the call context', () => {
        const ctx = createContext();
        reportDdlExtractorStats(ctx as unknown as IActionContext, makeStats(), 'utf-8');
        expect(ctx.telemetry.properties.encoding).toBe('utf-8');
        expect(ctx.telemetry.measurements.inputChars).toBe(100);
        expect(ctx.telemetry.measurements.createTable).toBe(2);
        expect(ctx.telemetry.measurements.reductionRatio).toBe(0.4);
    });

    it('accumulates phase-level rollups across calls', () => {
        const phaseCtx = createContext();
        reportDdlExtractorStats(
            createContext() as unknown as IActionContext,
            makeStats(),
            'utf-8',
            phaseCtx as unknown as IActionContext,
        );
        reportDdlExtractorStats(
            createContext() as unknown as IActionContext,
            makeStats(),
            'utf-8',
            phaseCtx as unknown as IActionContext,
        );
        expect(phaseCtx.telemetry.measurements.ddlFilesProcessed).toBe(2);
        expect(phaseCtx.telemetry.measurements.ddlInputCharsTotal).toBe(200);
    });
});
