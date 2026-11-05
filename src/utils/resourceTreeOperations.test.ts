/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { testGlobalSetup, UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { maskTreeElementTelemetry } from '../cosmosdb/maskResourceTelemetry';
import { callWithResourceTreeErrorHandling } from './resourceTreeOperations';

const mocks = vi.hoisted(() => ({
    send: vi.fn<
        (event: string, properties: Record<string, string | vscode.TelemetryTrustedValue | undefined>) => void
    >(),
}));

vi.mock('@vscode/extension-telemetry', () => ({
    TelemetryReporter: class {
        sendTelemetryErrorEvent = mocks.send;
        dispose() {}
    },
}));
vi.mock('@microsoft/vscode-azureresources-api', () => ({}));
vi.mock('../extensionVariables', () => ({ ext: {} }));
vi.mock('vscode', async (importOriginal) => {
    const original = await importOriginal<typeof vscode>();
    return {
        ...original,
        env: { appName: 'Telemetry test', language: 'en' },
        window: {
            ...original.window,
            createOutputChannel: vi.fn(() => ({ dispose: vi.fn() })),
        },
        TelemetryTrustedValue: class {
            constructor(public value: string) {}
        },
    };
});

describe('resource-operation emitted telemetry', () => {
    let sdkVariables: ReturnType<typeof testGlobalSetup> | undefined;
    const subscriptionId = '11111111-1111-1111-1111-111111111111';
    const tenantId = '22222222-2222-2222-2222-222222222222';
    const resource = {
        resourceId: `/subscriptions/${subscriptionId}/resourceGroups/sample-group/providers/Microsoft.DocumentDB/databaseAccounts/sample-account`,
        subscriptionId,
        resourceGroup: 'sample-group',
        accountName: 'sample-account',
    };
    const sensitiveText = 'sample-account sample-group private-credential private-database private-container';
    const unwrapped = (value: string | vscode.TelemetryTrustedValue | undefined) =>
        value instanceof vscode.TelemetryTrustedValue ? value.value : value;

    beforeAll(() => {
        sdkVariables = testGlobalSetup();
    });
    beforeEach(() => {
        mocks.send.mockClear();
    });
    afterAll(() => {
        sdkVariables?.outputChannel.dispose();
        sdkVariables?.context.subscriptions.forEach((subscription) => subscription.dispose());
    });

    function prepare(context: IActionContext): void {
        maskTreeElementTelemetry(context, {
            id: resource.resourceId,
            account: {
                id: resource.resourceId,
                name: resource.accountName,
                resourceGroup: resource.resourceGroup,
                subscription: { subscriptionId, tenantId },
            },
            model: {
                accountInfo: {
                    endpoint: 'https://sample-account.documents.azure.com',
                    credentials: [{ type: 'accountKey', key: 'private-credential' }],
                },
                database: { id: 'private-database' },
                container: { id: 'private-container' },
            },
        });
        Object.assign(context.telemetry.properties, {
            subscriptionId,
            tenantId,
            accountName: resource.accountName,
            resourceId: new vscode.TelemetryTrustedValue(resource.resourceId),
            detail: sensitiveText,
            accountId: resource.resourceId,
            resourceGroup: resource.resourceGroup,
            databaseName: 'private-database',
        });
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.suppressReportIssue = true;
    }

    for (const outcome of ['success', 'error', 'cancellation']) {
        it(`preserves structured OII and sanitizes other fields on ${outcome}`, async () => {
            const failure = outcome === 'cancellation' ? new UserCancelledError() : new Error(sensitiveText);
            const result = callWithResourceTreeErrorHandling(
                'oiiEmissionTest',
                (context) => {
                    prepare(context);
                    if (outcome !== 'success') {
                        throw failure;
                    }
                    return 'loaded';
                },
                { propagateErrors: true },
            );
            const settlement = await Promise.allSettled([result]);
            expect(settlement[0].status).toBe(outcome === 'success' ? 'fulfilled' : 'rejected');
            const properties = mocks.send.mock.calls.find(([event]) => event === 'oiiEmissionTest')?.[1] ?? {};

            expect(unwrapped(properties.subscriptionId)).toBe(subscriptionId);
            expect(unwrapped(properties.tenantId)).toBe(tenantId);
            expect(unwrapped(properties.accountName)).toBe(resource.accountName);
            expect(unwrapped(properties.resourceId)).toBe(resource.resourceId);
            expect(properties.subscriptionId).toBe(subscriptionId);
            expect(properties.tenantId).toBe(tenantId);
            expect(properties.accountName).toBe(resource.accountName);
            expect(properties.detail).toBe('sample-account sample-group --- --- ---');
            expect(properties.accountId).toBe(resource.resourceId);
            expect(properties.resourceGroup).toBe(resource.resourceGroup);
            expect(properties.databaseName).toBe('---');
            expect(properties.detail).not.toBeInstanceOf(vscode.TelemetryTrustedValue);
            expect(properties.errorMessage).not.toBeInstanceOf(vscode.TelemetryTrustedValue);
            expect(unwrapped(properties.errorMessage)).not.toContain('private-credential');
            expect(properties.result).toBe(
                outcome === 'success' ? 'Succeeded' : outcome === 'error' ? 'Failed' : 'Canceled',
            );
        });
    }

    it('leaves OII names visible in errors while redacting connection and child data', async () => {
        await callWithResourceTreeErrorHandling('oiiErrorTextTest', (context) => {
            prepare(context);
            throw new Error(sensitiveText);
        });
        const properties = mocks.send.mock.calls.find(([event]) => event === 'oiiErrorTextTest')?.[1] ?? {};
        expect(properties.errorMessageV2).toBe('sample-account sample-group --- --- ---');
    });

    it('allows the SDK generic GUID sanitizer in error text without masking the tenant property', async () => {
        await callWithResourceTreeErrorHandling('tenantEmissionTest', (context) => {
            prepare(context);
            throw new Error(`Tenant ${tenantId} could not complete the request`);
        });
        const properties = mocks.send.mock.calls.find(([event]) => event === 'tenantEmissionTest')?.[1] ?? {};
        expect(unwrapped(properties.tenantId)).toBe(tenantId);
        expect(properties.errorMessageV2).toBe('Tenant redacted:id could not complete the request');
    });

    it('does not convert empty values or unrelated fields to trusted properties', async () => {
        await callWithResourceTreeErrorHandling('emptyOiiTest', (context) => {
            Object.assign(context.telemetry.properties, { subscriptionId: '', tenantId: ' ', outcome: 'ready' });
        });
        const properties = mocks.send.mock.calls.find(([event]) => event === 'emptyOiiTest')?.[1] ?? {};
        expect(properties.subscriptionId).toBe('');
        expect(properties.tenantId).toBe(' ');
        expect(properties.outcome).toBe('ready');
    });
});
