/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PartitionKeyKind } from '@azure/cosmos';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type AzureResourceMetadata } from '../../cosmosdb/AzureResourceMetadata';
import { type CosmosDBControlPlane } from '../../cosmosdb/controlPlane';
import { type DeploymentRequest } from '../../dataModeling/deploymentModel';
import { ext } from '../../extensionVariables';
import * as provisioning from '../../panels/migration/helpers/provisionCosmosModel';
import { type DataModelerAccount } from '../../services/DataModelerProjectService';
import { deployDataModel, generateDeploymentTemplate, getDeploymentOptions } from './deployDataModel';

vi.mock('../../extensionVariables', () => ({
    ext: {
        cosmosDBBranchDataProvider: { refresh: vi.fn() },
        cosmosDBWorkspaceBranchDataProvider: { refresh: vi.fn() },
    },
}));
vi.mock('../../cosmosdb/withClaimsChallengeHandling', () => ({ withClaimsChallengeHandling: vi.fn() }));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardPromptStep: class {},
    parseError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
}));

const fields = { _rid: '', _self: '', _etag: '', _ts: 0 };
const plane = {
    listDatabases: vi.fn<CosmosDBControlPlane['listDatabases']>(),
    listContainers: vi.fn<CosmosDBControlPlane['listContainers']>(),
    createDatabase: vi.fn<CosmosDBControlPlane['createDatabase']>(),
    createContainer: vi.fn<CosmosDBControlPlane['createContainer']>(),
    deleteDatabase: vi.fn<CosmosDBControlPlane['deleteDatabase']>(),
    deleteContainer: vi.fn<CosmosDBControlPlane['deleteContainer']>(),
    readDatabaseThroughput: vi.fn<CosmosDBControlPlane['readDatabaseThroughput']>(),
    readContainerThroughput: vi.fn<CosmosDBControlPlane['readContainerThroughput']>(),
};
const account: DataModelerAccount = {
    name: 'Source',
    endpoint: 'https://source.documents.azure.com/',
    getControlPlane: () => plane,
};
const input = {
    databaseMode: 'existing' as const,
    databaseName: 'db',
    containers: [{ entity: 'Orders', partitionKey: '/tenant, /id' }],
};
function context(): IActionContext {
    return {
        valuesToMask: [],
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        ui: {
            onDidFinishPrompt: vi.fn(),
            showQuickPick: vi.fn(),
            showInputBox: vi.fn(),
            showWarningMessage: vi.fn(),
            showOpenDialog: vi.fn(),
            showWorkspaceFolderPick: vi.fn(),
        },
    };
}
function request(databaseMode: 'new' | 'existing' = 'existing'): DeploymentRequest {
    return { ...input, databaseMode };
}
beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    plane.listDatabases.mockResolvedValue([{ id: 'db', ...fields }]);
    plane.listContainers.mockResolvedValue([]);
    plane.createDatabase.mockImplementation(async (id) => ({ id, ...fields }));
    plane.createContainer.mockImplementation(async (_db, definition) => {
        if (!definition.id) throw new Error('Missing container id');
        return { ...definition, ...fields, id: definition.id };
    });
    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
    vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
    vi.spyOn(vscode.window, 'withProgress').mockImplementation(async (_options, task) =>
        task({ report: vi.fn() }, new vscode.CancellationTokenSource().token),
    );
});

describe('Data Modeler reuses migration provisioning', () => {
    it.each([
        { name: 'Engineering', expected: 'Engineering' },
        { name: '', expected: 'subscription-id' },
    ])('returns only display metadata for the originating subscription ($expected)', async ({ name, expected }) => {
        const metadata = {
            accountName: 'azure-account',
            resourceGroup: 'modeling-rg',
            subscription: { name, subscriptionId: 'subscription-id', tenantId: 'tenant-id' },
        } as AzureResourceMetadata;
        const result = await getDeploymentOptions({ ...account, getDeploymentTarget: () => metadata });
        expect(result).toEqual({
            accountName: 'azure-account',
            subscriptionName: expected,
            resourceGroup: 'modeling-rg',
            databases: ['db'],
        });
        expect(result).not.toHaveProperty('subscription');
        expect(result).not.toHaveProperty('getControlPlane');
    });

    it('loads databases and generates Bicep for connected accounts without requiring ARM deployment metadata', async () => {
        expect(await getDeploymentOptions(account)).toEqual({ accountName: 'Source', databases: ['db'] });
        const template = await generateDeploymentTemplate(account, input);
        expect(template).toContain("sqlDatabases@2024-05-15' existing");
        expect(template).toContain("param databaseName string = 'db'");
        expect(template).toContain("name: 'Orders'");
        expect(template).toContain("kind: 'MultiHash'");
        expect(template).not.toContain('sqlRoleAssignments');
    });

    it.each(['bicep', 'terraform', 'sdk'] as const)('generates %s without making any writes', async (format) => {
        const code = await generateDeploymentTemplate(account, { ...input, format });
        expect(code).toContain('Orders');
        expect(code).toContain('/tenant');
        expect(code).toContain('/id');
        expect(plane.createDatabase).not.toHaveBeenCalled();
        expect(plane.createContainer).not.toHaveBeenCalled();
    });

    it('defaults to the unchanged Bicep generator, preserving escaped names and ordered hierarchical keys', async () => {
        const value = {
            ...input,
            containers: [{ entity: "o'brien${literal}", partitionKey: '/tenant, /address/zip' }],
        };
        const code = await generateDeploymentTemplate(account, value);
        expect(code).toEqual(await generateDeploymentTemplate(account, { ...value, format: 'bicep' }));
        expect(code).toContain("name: 'o\\'brien\\${literal}'");
        expect(code).toContain("paths: ['/tenant', '/address/zip']");
    });

    it.each(['terraform', 'sdk'] as const)('uses host target metadata for %s', async (format) => {
        const metadata = {
            accountName: 'azure-account',
            resourceGroup: 'modeling-rg',
            subscription: { subscriptionId: 'subscription-id' },
        } as AzureResourceMetadata;
        const code = await generateDeploymentTemplate(
            { ...account, getDeploymentTarget: () => metadata },
            { ...input, format },
        );
        for (const value of ['azure-account', 'modeling-rg', 'subscription-id']) expect(code).toContain(value);
    });

    it('omits matching existing containers from Terraform ownership', async () => {
        plane.listContainers.mockResolvedValue([
            {
                id: 'Orders',
                ...fields,
                partitionKey: { paths: ['/tenant', '/id'], kind: PartitionKeyKind.MultiHash, version: 1 },
            },
        ]);
        const code = await generateDeploymentTemplate(account, {
            ...input,
            format: 'terraform',
            containers: [...input.containers, { entity: 'Users', partitionKey: '/id' }],
        });
        expect(code).not.toContain('"Orders" = {');
        expect(code).toContain('"Users" = {');
    });

    it.each(['bicep', 'terraform', 'sdk'] as const)('checks conflicts before exporting %s', async (format) => {
        plane.listContainers.mockResolvedValue([
            { id: 'Orders', ...fields, partitionKey: { paths: ['/id'], kind: PartitionKeyKind.Hash } },
        ]);
        await expect(generateDeploymentTemplate(account, { ...input, format })).rejects.toThrow(
            'different partition key',
        );
    });

    it.each(['terraform', 'sdk'] as const)('rejects a taken new database name for %s export', async (format) => {
        await expect(generateDeploymentTemplate(account, { ...input, databaseMode: 'new', format })).rejects.toThrow(
            'already exists',
        );
    });

    it.each(['terraform', 'sdk'] as const)('exports a new database for %s without provisioning it', async (format) => {
        plane.listDatabases.mockResolvedValue([]);
        const code = await generateDeploymentTemplate(account, { ...input, databaseMode: 'new', format });
        expect(code).toContain(
            format === 'terraform' ? 'resource "azurerm_cosmosdb_sql_database"' : 'databases.CreateOrUpdateAsync',
        );
        expect(plane.createDatabase).not.toHaveBeenCalled();
        expect(plane.createContainer).not.toHaveBeenCalled();
    });

    it('calls the shared migration pipeline with the selected model and creates containers directly', async () => {
        const shared = vi.spyOn(provisioning, 'provisionCosmosModel');
        const ctx = context();
        expect(await deployDataModel(account, request(), ctx)).toEqual({
            status: 'deployed',
            databaseName: 'db',
            createdCount: 1,
            existingCount: 0,
        });
        expect(shared).toHaveBeenCalledOnce();
        expect(shared.mock.calls[0][0].containers.map((container) => container.name)).toEqual(['Orders']);
        expect(plane.createDatabase).not.toHaveBeenCalled();
        expect(plane.createContainer).toHaveBeenCalledWith(
            'db',
            {
                id: 'Orders',
                partitionKey: { paths: ['/tenant', '/id'], kind: 'MultiHash', version: 2 },
                indexingPolicy: undefined,
            },
            undefined,
            undefined,
        );
        expect(ctx.telemetry.suppressAll).toBe(true);
        expect(ext.cosmosDBBranchDataProvider.refresh).toHaveBeenCalledOnce();
        expect(plane.deleteDatabase).not.toHaveBeenCalled();
        expect(plane.deleteContainer).not.toHaveBeenCalled();
    });

    it('creates a new database first and does not need a compiler or resource-group deployment', async () => {
        vi.stubEnv('PATH', '');
        try {
            plane.listDatabases.mockResolvedValue([]);
            const newRequest = request('new');
            expect(await deployDataModel(account, newRequest, context())).toMatchObject({ createdCount: 1 });
            expect(plane.createDatabase).toHaveBeenCalledWith('db');
            expect(plane.createDatabase.mock.invocationCallOrder[0]).toBeLessThan(
                plane.createContainer.mock.invocationCallOrder[0],
            );
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it.each(['template', 'format', 'code'])('rejects %s payloads sent to direct deployment', async (field) => {
        const value = { ...request(), [field]: 'sdk' };
        await expect(deployDataModel(account, value, context())).rejects.toThrow();
        expect(plane.createContainer).not.toHaveBeenCalled();
        expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it('preserves existing containers and supports retry after a partial deployment', async () => {
        const value = request();
        plane.createContainer.mockRejectedValueOnce(new Error('Quota exceeded'));
        await expect(deployDataModel(account, value, context())).rejects.toThrow('Quota exceeded');
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            expect.stringContaining('Some resources may already have been created'),
        );
        plane.listContainers.mockResolvedValue([
            {
                id: 'Orders',
                ...fields,
                defaultTtl: 600,
                partitionKey: { paths: ['/tenant', '/id'], kind: PartitionKeyKind.MultiHash, version: 1 },
            },
        ]);
        plane.createContainer.mockClear();
        expect(await deployDataModel(account, value, context())).toMatchObject({ createdCount: 0, existingCount: 1 });
        expect(plane.createContainer).not.toHaveBeenCalled();
    });

    it('rechecks conflicts before making changes', async () => {
        const value = request();
        plane.listContainers.mockResolvedValueOnce([]).mockResolvedValueOnce([
            {
                id: 'Orders',
                ...fields,
                partitionKey: { paths: ['/other'], kind: PartitionKeyKind.Hash, version: 2 },
            },
        ]);
        await expect(deployDataModel(account, value, context())).rejects.toThrow('different partition key');
        expect(plane.createContainer).not.toHaveBeenCalled();
    });

    it('does not turn a taken new database name into an update', async () => {
        const value = request('new');
        await expect(deployDataModel(account, value, context())).rejects.toThrow('already exists');
        expect(plane.createDatabase).not.toHaveBeenCalled();
    });

    it('prevents simultaneous deployment from multiple tabs of the same account', async () => {
        const value = request();
        let finish!: () => void;
        vi.mocked(vscode.window.withProgress).mockImplementationOnce(
            async (_options, task) =>
                new Promise((resolve) => {
                    finish = () => resolve(task({ report: vi.fn() }, new vscode.CancellationTokenSource().token));
                }) as ReturnType<typeof task>,
        );
        const pending = deployDataModel(account, value, context());
        await vi.waitFor(() => expect(vscode.window.withProgress).toHaveBeenCalledOnce());
        await expect(deployDataModel(account, value, context())).rejects.toThrow('already in progress');
        finish();
        expect(await pending).toMatchObject({ status: 'deployed' });
    });

    it('does not hide missing account access or database-list failures', async () => {
        const unsupported = { endpoint: account.endpoint };
        expect(await getDeploymentOptions(unsupported)).toMatchObject({
            databases: [],
            unavailableReason: expect.stringContaining('Reopen'),
        });
        await expect(generateDeploymentTemplate(unsupported, input)).rejects.toThrow('Reopen');
        plane.listDatabases.mockRejectedValue(new Error('Access denied'));
        await expect(getDeploymentOptions(account)).rejects.toThrow('Access denied');
    });
});
