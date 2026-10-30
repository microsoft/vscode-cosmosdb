/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { maskUserInfo } from '@microsoft/vscode-azext-utils';
import { describe, expect, it, vi } from 'vitest';
import { AuthenticationMethod } from './AuthenticationMethod';
import { maskTreeElementTelemetry } from './maskResourceTelemetry';

vi.mock('../extensionVariables', () => ({ ext: {} }));
vi.mock('@vscode/extension-telemetry', () => ({ default: vi.fn() }));
vi.mock('@microsoft/vscode-azureresources-api', () => ({}));

describe('resource telemetry masks', () => {
    const resource = {
        resourceId:
            '/subscriptions/private-subscription/resourceGroups/private-group/providers/Microsoft.DocumentDB/databaseAccounts/private-account',
        subscriptionId: 'private-subscription',
        resourceGroup: 'private-group',
        accountName: 'private-account',
    };
    const error = `Cannot load ${resource.accountName} in ${resource.resourceGroup} using ${resource.subscriptionId}`;

    it('does not register the full ARM resource identity as a mask', () => {
        const context = { valuesToMask: [] };
        maskTreeElementTelemetry(context, { id: resource.resourceId });
        expect(context.valuesToMask).toEqual([]);
        expect(maskUserInfo(error, context.valuesToMask)).toBe(error);
    });

    it('does not mask Azure account, resource-group, subscription, or tenant OII', () => {
        const context = { valuesToMask: [] };
        maskTreeElementTelemetry(context, {
            id: resource.resourceId,
            account: {
                id: resource.resourceId,
                name: resource.accountName,
                resourceGroup: resource.resourceGroup,
                subscription: { subscriptionId: resource.subscriptionId, tenantId: 'allowed-tenant' },
            },
        });
        expect(context.valuesToMask).toEqual([]);
        expect(maskUserInfo(error, context.valuesToMask)).toBe(error);
    });

    it('masks connection credentials and child IDs, not Azure account metadata', () => {
        const context = { valuesToMask: [] };
        maskTreeElementTelemetry(context, {
            id: `${resource.resourceId}/private-database/private-container`,
            model: {
                accountInfo: {
                    id: resource.resourceId,
                    name: resource.accountName,
                    endpoint: 'https://private-account.documents.azure.com',
                    credentials: [
                        { type: AuthenticationMethod.accountKey, key: 'private-credential' },
                        { type: AuthenticationMethod.managedIdentity, clientId: 'private-client' },
                        { type: AuthenticationMethod.entraId, tenantId: 'allowed-tenant' },
                    ],
                    azureMetadata: {
                        accountId: resource.resourceId,
                        accountName: resource.accountName,
                        resourceGroup: resource.resourceGroup,
                        subscription: { subscriptionId: resource.subscriptionId },
                    },
                },
                database: { id: 'private-database' },
                container: { id: 'private-container' },
                item: { id: 'private-document', content: 'not-a-mask' },
                procedure: { id: 'private-procedure' },
                trigger: { id: 'private-trigger' },
            },
        });
        expect(context.valuesToMask).toEqual(
            expect.arrayContaining([
                'https://private-account.documents.azure.com',
                'private-credential',
                'private-client',
                'private-database',
                'private-container',
                'private-document',
                'private-procedure',
                'private-trigger',
            ]),
        );
        expect(context.valuesToMask).not.toContain('allowed-tenant');
        expect(context.valuesToMask).not.toContain('not-a-mask');
        expect(context.valuesToMask.filter((value) => Object.values(resource).includes(value))).toEqual([]);
    });

    it('masks attached connection values independently without adding tenant IDs', () => {
        const connectionString =
            'AccountEndpoint=https://attached.documents.azure.com;AccountKey=private-credential;Database=private-database;TenantId=allowed-tenant';
        const context = { valuesToMask: [] };
        maskTreeElementTelemetry(context, { account: { id: 'attached', name: 'attached', connectionString } });
        expect(context.valuesToMask).toEqual(
            expect.arrayContaining([
                connectionString,
                'https://attached.documents.azure.com',
                'private-credential',
                'private-database',
            ]),
        );
        expect(context.valuesToMask).not.toContain('allowed-tenant');
    });

    it('ignores empty or absent optional values without changing other context fields', () => {
        const context = {
            valuesToMask: ['existing'],
            telemetry: { properties: { tenantId: 'allowed-tenant' }, measurements: {} },
            errorHandling: { rethrow: true },
        };
        const before = structuredClone(context);
        maskTreeElementTelemetry(context, {
            id: '',
            account: { id: '', name: ' ', connectionString: 'AccountKey=;Database= \t ' },
            model: { accountInfo: { credentials: [{ type: AuthenticationMethod.accountKey, key: '' }] } },
        });
        // The non-empty full connection string is still a sensitive value even when its individual values are blank.
        expect(context).toEqual({ ...before, valuesToMask: ['existing', 'AccountKey=;Database= \t '] });
    });
});
