/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { globalUriHandler } from '../vscodeUriHandler';
import { wellKnownEmulatorPassword } from './cosmosdb-shared-constants';
import { parseCosmosDBConnectionString } from './cosmosDBConnectionStrings';

const mocks = vi.hoisted(() => ({
    push: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn(),
    revealWorkspaceResource: vi.fn().mockResolvedValue(undefined),
    revealAzureResource: vi.fn().mockResolvedValue(undefined),
    getSelectedAzureNode: vi.fn().mockResolvedValue(undefined),
    findNodeById: vi.fn(async (id: string) => ({ id })),
    getAccountInfo: vi.fn(),
    openNoSqlQueryEditor: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockResolvedValue(false),
    isEmulator: vi.fn().mockReturnValue(false),
}));

vi.mock('vscode', async (importOriginal) => ({
    ...(await importOriginal<typeof vscode>()),
    TelemetryTrustedValue: class {
        constructor(public value: string) {}
    },
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: async (
        _name: string,
        callback: (context: Pick<IActionContext, 'telemetry' | 'valuesToMask' | 'errorHandling'>) => Promise<unknown>,
    ) =>
        callback({
            telemetry: { properties: {}, measurements: {} },
            valuesToMask: [],
            errorHandling: { issueProperties: {} },
        }),
    UserCancelledError: class extends Error {
        _isUserCancelledError = true;
    },
    isUserCancelledError: (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        '_isUserCancelledError' in error &&
        error._isUserCancelledError === true,
}));
vi.mock('@microsoft/vscode-azext-azureutils', () => ({
    parseAzureResourceId: (rawId: string) => ({
        rawId,
        provider: 'Microsoft.DocumentDB/databaseAccounts',
        subscriptionId: 'subscription',
        resourceGroup: rawId.split('/')[4],
        resourceName: rawId.split('/')[8],
    }),
}));
vi.mock('../AzureDBExperiences', () => ({
    API: { Core: 'Core' },
    getExperienceFromApi: () => ({ longName: 'Cosmos DB' }),
}));
vi.mock('../commands/openNoSqlQueryEditor/openNoSqlQueryEditor', () => ({
    openNoSqlQueryEditor: mocks.openNoSqlQueryEditor,
}));
vi.mock('../constants', () => ({ azureResourcesExtensionId: 'ms-azuretools.vscode-azureresourcegroups' }));
vi.mock('../extensionVariables', () => ({
    ext: {
        rgApiV2Ready: Promise.resolve(true),
        rgApiV2: {
            resources: {
                revealWorkspaceResource: mocks.revealWorkspaceResource,
                revealAzureResource: mocks.revealAzureResource,
                getSelectedAzureNode: mocks.getSelectedAzureNode,
            },
        },
        cosmosDBWorkspaceBranchDataProvider: { refresh: mocks.refresh },
        cosmosDBBranchDataProvider: { findNodeById: mocks.findNodeById },
        state: {
            showCreatingChild: async (_parentId: string, _label: string, callback: () => Promise<void>) => callback(),
        },
    },
}));
vi.mock('../services/StorageService', () => ({
    StorageNames: { Workspace: 'workspace' },
    StorageService: { get: () => ({ push: mocks.push }) },
}));
vi.mock('../tree/cosmosdb/AccountInfo', () => ({ getAccountInfo: mocks.getAccountInfo }));
vi.mock('../tree/workspace-api/SharedWorkspaceResourceProvider', () => ({
    WorkspaceResourceType: { AttachedAccounts: 'attachedAccounts' },
}));
vi.mock('../utils/dialogs/getConfirmation', () => ({ getConfirmationAsInSettings: mocks.confirm }));
vi.mock('../utils/emulatorUtils', () => ({
    getIsEmulatorConnection: mocks.isEmulator,
    getEmulatorItemLabelForApi: vi.fn(),
    getEmulatorItemUniqueId: vi.fn(),
}));

function makeUri(params: Record<string, string>): vscode.Uri {
    return vscode.Uri.parse(`vscode://ms-azuretools.vscode-cosmosdb/?${new URLSearchParams(params).toString()}`);
}

function expectNoConnectionSideEffects(): void {
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.revealWorkspaceResource).not.toHaveBeenCalled();
    expect(mocks.revealAzureResource).not.toHaveBeenCalled();
    expect(mocks.getAccountInfo).not.toHaveBeenCalled();
    expect(mocks.openNoSqlQueryEditor).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.isEmulator).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
}

describe('cosmosDBConnectionStrings', () => {
    // Testing different ordering, different use of ';', different casing, etc.
    describe('Without database name', () => {
        it('Connection string with AccountEndpoint only', () => {
            const parsedCS = parseCosmosDBConnectionString('AccountEndpoint=https://abcdef.documents.azure.com:443/');
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual(undefined);
            expect(parsedCS.databaseName).toEqual(undefined);
            expect(parsedCS.tenantId).toEqual(undefined);
        });

        it('Connection string with empty database', () => {
            const parsedCS = parseCosmosDBConnectionString(
                'AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with TenantId', () => {
            const parsedCS = parseCosmosDBConnectionString(
                'AccountEndpoint=https://abcdef.documents.azure.com:443/;TenantId=00000000-0000-0000-0000-000000000000',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual(undefined);
            expect(parsedCS.databaseName).toEqual(undefined);
            expect(parsedCS.tenantId).toEqual('00000000-0000-0000-0000-000000000000');
        });

        it('Connection string with leading empty string in AccountEndpoint', () => {
            const parsedCS = parseCosmosDBConnectionString(
                '    AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with leading empty string in AccountKey', () => {
            const parsedCS = parseCosmosDBConnectionString(
                'AccountEndpoint=https://abcdef.documents.azure.com:443/;    AccountKey=abcdef==',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with trailing semicolon', () => {
            const parsedCS = parseCosmosDBConnectionString(
                'AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with AccountKey first', () => {
            const parsedCS = parseCosmosDBConnectionString(
                'AccountKey=abcdef==;AccountEndpoint=https://abcdef.documents.azure.com:443/',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with AccountKey first and trailing semicolon', () => {
            const parsedCS = parseCosmosDBConnectionString(
                'AccountKey=abcdef==;AccountEndpoint=https://abcdef.documents.azure.com:443/;',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with lowercase', () => {
            const parsedCS = parseCosmosDBConnectionString(
                'accountendpoint=https://abcdef.documents.azure.com:443/;accountkey=abcdef==',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with empty Database key', () => {
            const parsedCS = parseCosmosDBConnectionString(
                'AccountKey=abcdef==;AccountEndpoint=https://abcdef.documents.azure.com:443/;Database=',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with empty Database key and trailing semicolon', () => {
            const parsedCS = parseCosmosDBConnectionString(
                'AccountKey=abcdef==;AccountEndpoint=https://abcdef.documents.azure.com:443/;Database=;',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with emulator', () => {
            const parsedCS = parseCosmosDBConnectionString(
                `AccountEndpoint=https://localhost:10255/;AccountKey=${wellKnownEmulatorPassword};`,
            );
            expect(parsedCS.documentEndpoint).toEqual('https://localhost:10255/');
            expect(parsedCS.masterKey).toEqual(wellKnownEmulatorPassword);
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with other properties', () => {
            const parsedCS = parseCosmosDBConnectionString(
                'AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;',
            );
            expect(parsedCS.hostName).toEqual('abcdef.documents.azure.com');
            expect(parsedCS.port).toEqual('443');
            expect(parsedCS.accountId).toEqual('abcdef.documents.azure.com:443');
            expect(parsedCS.fullId).toEqual('abcdef.documents.azure.com:443');
        });
    });

    // Testing different ordering, different use of ';', different casing, etc.
    describe('With database name', () => {
        it('Connection string with database', () => {
            const parsedCS = parseCosmosDBConnectionString(
                'AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;Database=abcd',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual('abcd');
        });

        it('Connection string with trailing semicolon', () => {
            const parsedCS = parseCosmosDBConnectionString(
                'AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;Database=abcd;',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual('abcd');
        });

        it('Connection string with Database in the middle', () => {
            const parsedCS = parseCosmosDBConnectionString(
                'AccountEndpoint=https://abcdef.documents.azure.com:443/;Database=abcd;AccountKey=abcdef==',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual('abcd');
        });

        it('Connection string with Database first and trailing semicolon', () => {
            const parsedCS = parseCosmosDBConnectionString(
                'Database=abcd;AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual('abcd');
        });

        it('Connection string with other properties', () => {
            const parsedCS = parseCosmosDBConnectionString(
                'AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;Database=abcd',
            );
            expect(parsedCS.hostName).toEqual('abcdef.documents.azure.com');
            expect(parsedCS.port).toEqual('443');
            expect(parsedCS.accountId).toEqual('abcdef.documents.azure.com:443');
            expect(parsedCS.fullId).toEqual('abcdef.documents.azure.com:443/abcd');
        });
    });

    it('Invalid connection strings', () => {
        expect(() => parseCosmosDBConnectionString('')).toThrow(Error);
        expect(() => parseCosmosDBConnectionString('AccountKey=abcdef==')).toThrow(Error);
        expect(() =>
            parseCosmosDBConnectionString(
                'mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==' +
                    '@your-mongo.documents.azure.com:10255/?ssl=true&replicaSet=globaldb',
            ),
        ).toThrow(Error);
        expect(() => parseCosmosDBConnectionString('AccountEndpoint=abcd;AccountKey=abcdef==;Database=abcd')).toThrow(
            /Invalid URL/,
        );
    });
});

describe('external URI connection domains', () => {
    let cancellation: vscode.CancellationTokenSource;
    const tenantId = '22222222-2222-2222-2222-222222222222';

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.revealWorkspaceResource.mockReset().mockResolvedValue(undefined);
        mocks.getSelectedAzureNode.mockReset().mockResolvedValue(undefined);
        mocks.revealAzureResource.mockReset().mockImplementation(async (id: string) => {
            mocks.getSelectedAzureNode.mockResolvedValue(id);
        });
        mocks.getAccountInfo.mockReset();
        cancellation = new vscode.CancellationTokenSource();
        vi.spyOn(vscode.window, 'withProgress').mockImplementation((_options, task) =>
            task({ report: vi.fn() }, cancellation.token),
        );
        vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    });

    afterEach(() => {
        cancellation.dispose();
        vi.restoreAllMocks();
    });

    it.each([
        'https://cosmos.fabric.microsoft.com/',
        'https://account.cosmos.fabric.microsoft.com/',
        'https://account.z79.dxt-sql.cosmos.fabric.microsoft.com:443/',
        'https://account.msit-sql.cosmos.fabric.microsoft.com/',
        'https://account.daily-sql.cosmos.fabric.microsoft.com/',
        'https://ACCOUNT.COSMOS.FABRIC.MICROSOFT.COM/',
    ])('accepts Fabric endpoint %s', async (endpoint) => {
        const connectionString = `AccountEndpoint=${endpoint};Database=database;`;

        await globalUriHandler(
            makeUri({
                cs: connectionString,
                tenantId,
                database: 'database',
                workspaceId: 'workspace',
                artifactId: 'artifact',
                artifactType: 'CosmosDBDatabase',
            }),
        );

        expect(mocks.push).toHaveBeenCalledExactlyOnceWith(
            'attachedAccounts',
            expect.objectContaining({
                id: `${new URL(endpoint).hostname}:443`,
                properties: { api: 'Core', isEmulator: false, tenantId },
                secrets: [connectionString],
            }),
            false,
        );
        expect(mocks.refresh).toHaveBeenCalledOnce();
        expect(mocks.revealWorkspaceResource).toHaveBeenCalledTimes(3);
        expect(mocks.revealWorkspaceResource).toHaveBeenNthCalledWith(
            2,
            `attachedAccounts/${new URL(endpoint).hostname}:443`,
            { select: true, focus: true, expand: true },
        );
        expect(mocks.revealWorkspaceResource).toHaveBeenLastCalledWith(
            `attachedAccounts/${new URL(endpoint).hostname}:443/database`,
            { select: true, focus: true, expand: true },
        );
    });

    it('reveals the attached account only once when no database is specified', async () => {
        await globalUriHandler(makeUri({ cs: 'AccountEndpoint=https://account.cosmos.fabric.microsoft.com/;' }));

        expect(mocks.revealWorkspaceResource.mock.calls).toEqual([
            ['attachedAccounts', { select: true, focus: true, expand: true }],
            ['attachedAccounts/account.cosmos.fabric.microsoft.com:443', { select: true, focus: true, expand: true }],
        ]);
        expect(mocks.getAccountInfo).not.toHaveBeenCalled();
        expect(mocks.openNoSqlQueryEditor).not.toHaveBeenCalled();
    });

    it('expands the account before revealing a container and opening its editor', async () => {
        const endpoint = 'https://account.cosmos.fabric.microsoft.com:443/';
        const accountId = 'attachedAccounts/account.cosmos.fabric.microsoft.com:443';
        mocks.getAccountInfo.mockResolvedValueOnce({ endpoint, credentials: [] });

        await globalUriHandler(
            makeUri({ cs: `AccountEndpoint=${endpoint};`, database: 'database', container: 'container' }),
        );

        expect(mocks.revealWorkspaceResource.mock.calls).toEqual([
            ['attachedAccounts', { select: true, focus: true, expand: true }],
            [accountId, { select: true, focus: true, expand: true }],
            [`${accountId}/database/container`, { select: true, focus: true, expand: true }],
        ]);
        expect(mocks.openNoSqlQueryEditor).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
            databaseId: 'database',
            containerId: 'container',
            endpoint,
            credentials: [],
            isEmulator: false,
        });
    });

    it('reveals the account even when descendant reveal silently finds no target', async () => {
        const accountId = 'attachedAccounts/account.cosmos.fabric.microsoft.com:443';
        const revealed: string[] = [];
        mocks.revealWorkspaceResource.mockImplementation(async (id: string) => {
            if (id === 'attachedAccounts' || id === accountId) {
                revealed.push(id);
            }
        });

        await globalUriHandler(
            makeUri({
                cs: 'AccountEndpoint=https://account.cosmos.fabric.microsoft.com/;',
                database: 'missing-database',
            }),
        );

        expect(revealed).toEqual(['attachedAccounts', accountId]);
        expect(mocks.revealWorkspaceResource).toHaveBeenLastCalledWith(`${accountId}/missing-database`, {
            select: true,
            focus: true,
            expand: true,
        });
    });

    it('waits for account reveal before attempting to reveal the database', async () => {
        const accountId = 'attachedAccounts/account.cosmos.fabric.microsoft.com:443';
        let finishAccountReveal!: () => void;
        let signalAccountReveal!: () => void;
        const accountReveal = new Promise<void>((resolve) => {
            finishAccountReveal = resolve;
        });
        const accountRevealStarted = new Promise<void>((resolve) => {
            signalAccountReveal = resolve;
        });
        mocks.revealWorkspaceResource.mockImplementation(async (id: string) => {
            if (id === accountId) {
                signalAccountReveal();
                await accountReveal;
            }
        });

        const handling = globalUriHandler(
            makeUri({ cs: 'AccountEndpoint=https://account.cosmos.fabric.microsoft.com/;', database: 'database' }),
        );
        try {
            await accountRevealStarted;
            expect(mocks.revealWorkspaceResource.mock.calls.map(([id]) => id)).toEqual(['attachedAccounts', accountId]);
        } finally {
            finishAccountReveal();
            await handling;
        }

        expect(mocks.revealWorkspaceResource).toHaveBeenLastCalledWith(`${accountId}/database`, {
            select: true,
            focus: true,
            expand: true,
        });
    });

    it.each([
        'https://127.0.0.1:8445/',
        'https://localhost:8081/',
        'https://[::1]:8081/',
        'https://account.documents.azure.com/',
        'https://cosmos-probe.invalid/',
        'https://fabric.microsoft.com/',
        'https://evilcosmos.fabric.microsoft.com/',
        'https://cosmos.fabric.microsoft.com.evil.invalid/',
        'https://account.cosmos.fabric.microsoft.com.evil.invalid/',
        'https://cosmos.fabric.microsoft.com@evil.invalid/',
        'https://evil.invalid/cosmos.fabric.microsoft.com',
        'https://evil.invalid/?host=cosmos.fabric.microsoft.com',
        'https://evil.invalid/#cosmos.fabric.microsoft.com',
    ])('rejects %s before any connection side effect', async (endpoint) => {
        await expect(
            globalUriHandler(
                makeUri({
                    cs: `AccountEndpoint=${endpoint};`,
                    tenantId,
                    database: 'database',
                    container: 'container',
                }),
            ),
        ).rejects.toThrow('The endpoint specified in this link is not supported.');

        expectNoConnectionSideEffects();
    });

    it.each(['https://account.documents.azure.com/', 'https://account.example.invalid/'])(
        'uses Azure resource coordinates instead of connecting to %s',
        async (endpoint) => {
            await globalUriHandler(
                makeUri({
                    cs: `AccountEndpoint=${endpoint};AccountKey=unused-key;`,
                    subscriptionId: 'subscription',
                    resourceGroup: 'resource-group',
                }),
            );

            expect(mocks.revealAzureResource).toHaveBeenCalledExactlyOnceWith(
                '/subscriptions/subscription/resourceGroups/resource-group/providers/Microsoft.DocumentDb/databaseAccounts/account',
                { select: true, focus: true, expand: true },
            );
            expect(mocks.push).not.toHaveBeenCalled();
            expect(mocks.revealWorkspaceResource).not.toHaveBeenCalled();
            expect(mocks.getAccountInfo).not.toHaveBeenCalled();
            expect(mocks.openNoSqlQueryEditor).not.toHaveBeenCalled();
            expect(mocks.isEmulator).not.toHaveBeenCalled();
        },
    );

    it.each(['subscriptionId', 'resourceGroup'])(
        'rejects non-Fabric endpoints when Azure coordinates are incomplete: %s',
        async (coordinate) => {
            await expect(
                globalUriHandler(
                    makeUri({
                        cs: 'AccountEndpoint=https://account.example.invalid/;',
                        [coordinate]: 'test-coordinate',
                    }),
                ),
            ).rejects.toThrow('The endpoint specified in this link is not supported.');

            expectNoConnectionSideEffects();
        },
    );

    it('does not fall back to attaching the connection string if Azure resource lookup fails', async () => {
        mocks.findNodeById.mockRejectedValueOnce(new Error('Resource lookup failed'));

        await expect(
            globalUriHandler(
                makeUri({
                    cs: 'AccountEndpoint=https://account.example.invalid/;',
                    subscriptionId: 'subscription',
                    resourceGroup: 'resource-group',
                    database: 'database',
                    container: 'container',
                }),
            ),
        ).rejects.toThrow('Resource lookup failed');

        expect(mocks.push).not.toHaveBeenCalled();
        expect(mocks.revealWorkspaceResource).not.toHaveBeenCalled();
        expect(mocks.getAccountInfo).not.toHaveBeenCalled();
        expect(mocks.openNoSqlQueryEditor).not.toHaveBeenCalled();
    });

    it('preserves resource-ID links without a connection string', async () => {
        const resourceId =
            '/subscriptions/subscription/resourceGroups/resource-group/providers/Microsoft.DocumentDB/databaseAccounts/account';

        await globalUriHandler(makeUri({ resourceId }));

        expect(mocks.revealAzureResource).toHaveBeenCalledExactlyOnceWith(resourceId, {
            select: true,
            focus: true,
            expand: true,
        });
        expect(mocks.push).not.toHaveBeenCalled();
        expect(mocks.revealWorkspaceResource).not.toHaveBeenCalled();
        expect(mocks.getAccountInfo).not.toHaveBeenCalled();
    });

    it.each(['AccountEndpoint=https://account.example.invalid/;', 'not-a-connection-string'])(
        'ignores cs when a full resource ID is supplied: %s',
        async (connectionString) => {
            const resourceId =
                '/subscriptions/subscription/resourceGroups/resource-group/providers/Microsoft.DocumentDB/databaseAccounts/account';

            await globalUriHandler(makeUri({ resourceId, cs: connectionString }));

            expect(mocks.revealAzureResource).toHaveBeenCalledExactlyOnceWith(resourceId, {
                select: true,
                focus: true,
                expand: true,
            });
            expect(mocks.push).not.toHaveBeenCalled();
            expect(mocks.revealWorkspaceResource).not.toHaveBeenCalled();
            expect(mocks.getAccountInfo).not.toHaveBeenCalled();
            expect(mocks.openNoSqlQueryEditor).not.toHaveBeenCalled();
        },
    );
});
