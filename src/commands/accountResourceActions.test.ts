/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as AzExtUtils from '@microsoft/vscode-azext-utils';
import { AzureWizard, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreExperience, FabricNativeExperience } from '../AzureDBExperiences';
import { armTestSubscription, createArmTestContext } from '../cosmosdb/armTestUtils';
import { AuthenticationMethod } from '../cosmosdb/AuthenticationMethod';
import { getControlPlane } from '../cosmosdb/controlPlane';
import { getAccountInfo, type AccountInfo } from '../tree/cosmosdb/AccountInfo';
import { type FabricTreeElement } from '../tree/fabric-resources-view/FabricTreeElement';
import { NoSqlAccountAttachedResourceItem } from '../tree/nosql/NoSqlAccountAttachedResourceItem';
import { NoSqlAccountResourceItem } from '../tree/nosql/NoSqlAccountResourceItem';
import { NoSqlDatabaseResourceItem } from '../tree/nosql/NoSqlDatabaseResourceItem';
import { showConfirmationAsInSettings } from '../utils/dialogs/showConfirmation';
import { pickAppResource } from '../utils/pickItem/pickAppResource';
import { CosmosDBExecuteStep as CreateContainerStep } from './createContainer/CosmosDBExecuteStep';
import { CosmosDBThroughputStep } from './createContainer/CosmosDBThroughputStep';
import { cosmosDBCreateContainer, createContainer } from './createContainer/createContainer';
import { type CreateContainerWizardContext } from './createContainer/CreateContainerWizardContext';
import { CosmosDBExecuteStep as CreateDatabaseStep } from './createDatabase/CosmosDBExecuteStep';
import { cosmosDBCreateDatabase, createDatabase } from './createDatabase/createDatabase';
import { type CreateDatabaseWizardContext } from './createDatabase/CreateDatabaseWizardContext';

const mocks = vi.hoisted(() => ({
    prompt: vi.fn(),
    execute: vi.fn(),
    createDatabase: vi.fn(),
    createContainer: vi.fn(),
    showCreatingChild: vi.fn(async (_id: string, _label: string, action: () => Promise<void>) => action()),
}));

vi.mock('@vscode/extension-telemetry', () => ({ default: class {} }));
vi.mock('@microsoft/vscode-azureresources-api', () => ({
    AzExtResourceType: { AzureCosmosDb: 'AzureCosmosDb' },
}));
vi.mock('@microsoft/vscode-azext-azureutils', () => ({
    createAuthorizationManagementClient: vi.fn(),
    getResourceGroupFromId: vi.fn(),
}));
vi.mock('@microsoft/vscode-azext-azureauth', () => ({ getSessionFromVSCode: vi.fn() }));
vi.mock('../utils/azureClients', () => ({ createCosmosDBManagementClient: vi.fn() }));
vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof AzExtUtils>()),
    AzureWizard: vi.fn(
        class {
            constructor(private readonly context: CreateContainerWizardContext | CreateDatabaseWizardContext) {}
            prompt = async () => {
                await mocks.prompt();
                if ('databaseId' in this.context) {
                    this.context.containerName = 'new-container';
                } else {
                    this.context.databaseName = 'new-database';
                }
            };
            execute = mocks.execute;
        },
    ),
}));
vi.mock('../tree/cosmosdb/AccountInfo', () => ({ getAccountInfo: vi.fn() }));
vi.mock('../cosmosdb/controlPlane', () => ({
    getControlPlane: vi.fn(() => ({
        createDatabase: mocks.createDatabase,
        createContainer: mocks.createContainer,
    })),
}));
vi.mock('../extensionVariables', () => ({
    ext: {
        state: { showCreatingChild: mocks.showCreatingChild },
        get cosmosDBBranchDataProvider() {
            throw new Error('Creating resources must not look up Explorer nodes.');
        },
    },
}));
vi.mock('../utils/dialogs/showConfirmation', () => ({ showConfirmationAsInSettings: vi.fn() }));
vi.mock('../utils/pickItem/pickAppResource', () => ({ pickAppResource: vi.fn() }));

function accountInfo(overrides: Partial<AccountInfo> = {}): AccountInfo {
    return {
        id: '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account',
        name: 'account',
        endpoint: 'https://account.documents.azure.com',
        credentials: [{ type: AuthenticationMethod.accountKey, key: 'private-key' }],
        isEmulator: false,
        isServerless: false,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.prompt.mockReset();
    mocks.execute.mockReset();
    mocks.createDatabase.mockReset();
    mocks.createContainer.mockReset();
    vi.mocked(pickAppResource).mockReset();
    vi.mocked(getAccountInfo).mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('shared creation wizards', () => {
    it('creates a database from AccountInfo with no node or node ID in its context', async () => {
        const context = createArmTestContext();
        const info = accountInfo();
        await createDatabase(context, info, CoreExperience);
        expect(AzureWizard).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ accountInfo: info }),
            expect.objectContaining({
                title: 'Create database',
                executeSteps: [expect.any(CreateDatabaseStep)],
                showLoadingPrompt: true,
            }),
        );
        const wizardContext = vi.mocked(AzureWizard).mock.calls[0][0];
        expect(wizardContext).not.toHaveProperty('node');
        expect(wizardContext).not.toHaveProperty('nodeId');
        expect(mocks.prompt).toHaveBeenCalledOnce();
        expect(mocks.execute).toHaveBeenCalledOnce();
        expect(showConfirmationAsInSettings).toHaveBeenCalledExactlyOnceWith(
            'The "new-database" database has been created.',
        );
        expect(pickAppResource).not.toHaveBeenCalled();
        expect(getAccountInfo).not.toHaveBeenCalled();
        expect(context.valuesToMask).toEqual(
            expect.arrayContaining([info.id, info.name, info.endpoint, 'private-key']),
        );
        expect(context.telemetry.properties).toEqual({ experience: CoreExperience.api });
    });

    it.each([
        [CoreExperience, false, false],
        [CoreExperience, true, false],
        [CoreExperience, false, true],
        [FabricNativeExperience, false, false],
    ] as const)(
        'preserves container experience and account flags: %j, serverless=%s, emulator=%s',
        async (experience, isServerless, isEmulator) => {
            const context = createArmTestContext();
            const info = accountInfo({ isServerless, isEmulator });
            await createContainer(context, info, 'database', experience);
            expect(AzureWizard).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({
                    accountInfo: info,
                    databaseId: 'database',
                    experience,
                    throughput: undefined,
                    maxThroughput: undefined,
                }),
                expect.objectContaining({
                    title: 'Create container',
                    executeSteps: [expect.any(CreateContainerStep)],
                    showLoadingPrompt: true,
                }),
            );
            const wizardContext = vi.mocked(AzureWizard).mock.calls[0][0];
            expect(wizardContext).not.toHaveProperty('node');
            expect(wizardContext).not.toHaveProperty('nodeId');
            expect(mocks.prompt).toHaveBeenCalledOnce();
            expect(mocks.execute).toHaveBeenCalledOnce();
            expect(showConfirmationAsInSettings).toHaveBeenCalledExactlyOnceWith(
                'The "new-container" container has been created.',
            );
            expect(pickAppResource).not.toHaveBeenCalled();
            expect(getAccountInfo).not.toHaveBeenCalled();
            expect(context.telemetry.properties).toEqual({
                experience: experience.api,
                isServerless: String(isServerless),
                isEmulator: String(isEmulator),
            });
            expect(context.valuesToMask).toEqual(
                expect.arrayContaining([info.id, info.name, info.endpoint, 'private-key', 'database']),
            );

            const throughputContext: CreateContainerWizardContext = {
                ...context,
                accountInfo: info,
                databaseId: 'database',
                experience,
            };
            expect(new CosmosDBThroughputStep().shouldPrompt(throughputContext)).toBe(
                !isServerless && experience !== FabricNativeExperience,
            );
            expect(throughputContext.throughput).toBe(
                isServerless || experience === FabricNativeExperience ? 0 : undefined,
            );
            expect(throughputContext.maxThroughput).toBe(
                !isServerless && experience === FabricNativeExperience ? 5_000 : undefined,
            );
        },
    );

    it.each(['database', 'container'])(
        'propagates %s prompt cancellation and execute failure without success confirmation',
        async (resource) => {
            const run = () =>
                resource === 'database'
                    ? createDatabase(createArmTestContext(), accountInfo(), CoreExperience)
                    : createContainer(createArmTestContext(), accountInfo(), 'database', CoreExperience);
            const cancellation = new UserCancelledError();
            mocks.prompt.mockRejectedValueOnce(cancellation);
            await expect(run()).rejects.toBe(cancellation);
            expect(mocks.execute).not.toHaveBeenCalled();
            expect(showConfirmationAsInSettings).not.toHaveBeenCalled();
            const failure = new Error('Create failed');
            mocks.execute.mockRejectedValueOnce(failure);
            await expect(run()).rejects.toBe(failure);
            expect(showConfirmationAsInSettings).not.toHaveBeenCalled();
        },
    );
});

describe('Explorer adapters', () => {
    it.each([false, true])(
        'extracts account information from an Azure node, using the picker only when needed: %s',
        async (usePicker) => {
            const info = accountInfo();
            const node = new NoSqlAccountResourceItem(
                {
                    id: info.id,
                    name: info.name,
                    type: 'microsoft.documentdb/databaseaccounts',
                    subscription: armTestSubscription,
                    azureResourceType: { type: 'microsoft.documentdb/databaseaccounts' },
                    raw: {},
                },
                CoreExperience,
            );
            vi.mocked(getAccountInfo).mockResolvedValueOnce(info);
            vi.mocked(pickAppResource).mockResolvedValueOnce(node);
            await cosmosDBCreateDatabase(createArmTestContext(), usePicker ? undefined : node);
            expect(getAccountInfo).toHaveBeenCalledExactlyOnceWith(node.account);
            expect(pickAppResource).toHaveBeenCalledTimes(Number(usePicker));
            expect(AzureWizard).toHaveBeenCalledWith(expect.objectContaining({ accountInfo: info }), expect.anything());
        },
    );

    it('preserves the attached/emulator account adapter', async () => {
        const info = accountInfo({ id: 'attached-emulator-id', isEmulator: true });
        const node = new NoSqlAccountAttachedResourceItem(
            {
                id: info.id,
                storageId: 'attached-storage-id',
                name: info.name,
                isEmulator: true,
                connectionString: 'AccountEndpoint=https://localhost:8081/;AccountKey=private-key;',
            },
            CoreExperience,
        );
        vi.mocked(getAccountInfo).mockResolvedValueOnce(info);
        await cosmosDBCreateDatabase(createArmTestContext(), node);
        expect(getAccountInfo).toHaveBeenCalledExactlyOnceWith(node.account);
        expect(AzureWizard).toHaveBeenCalledWith(expect.objectContaining({ accountInfo: info }), expect.anything());
        expect(pickAppResource).not.toHaveBeenCalled();
    });

    it.each(['node', 'picker', 'fabric'])('extracts container wizard data from the %s adapter', async (source) => {
        const info = accountInfo();
        const experience = source === 'fabric' ? FabricNativeExperience : CoreExperience;
        const node = new NoSqlDatabaseResourceItem(
            {
                accountInfo: info,
                database: { id: 'database', _rid: 'database-rid', _ts: 0, _self: 'dbs/database/', _etag: 'etag' },
            },
            experience,
        );
        const wrapped: FabricTreeElement = {
            id: 'fabric-wrapper',
            element: node,
            getChildNodes: async () => [],
        };
        vi.mocked(pickAppResource).mockResolvedValueOnce(node);
        await cosmosDBCreateContainer(
            createArmTestContext(),
            source === 'picker' ? undefined : source === 'fabric' ? wrapped : node,
        );
        expect(AzureWizard).toHaveBeenCalledWith(
            expect.objectContaining({ accountInfo: info, databaseId: 'database', experience }),
            expect.anything(),
        );
        expect(pickAppResource).toHaveBeenCalledTimes(Number(source === 'picker'));
        expect(getAccountInfo).not.toHaveBeenCalled();
    });
});

describe('creation execution without nodes', () => {
    it.each(['azure-account-id', 'attached-account-id'])(
        'derives database progress identity from AccountInfo: %s',
        async (id) => {
            vi.useFakeTimers();
            const info = accountInfo({ id });
            const pending = new CreateDatabaseStep().execute({
                ...createArmTestContext(),
                accountInfo: info,
                databaseName: 'new-database',
            });
            await vi.runAllTimersAsync();
            await pending;
            expect(mocks.showCreatingChild).toHaveBeenCalledExactlyOnceWith(
                id,
                'Creating "new-database"…',
                expect.any(Function),
            );
            expect(getControlPlane).toHaveBeenCalledExactlyOnceWith(info);
            expect(mocks.createDatabase).toHaveBeenCalledExactlyOnceWith('new-database');
        },
    );

    it('derives container progress identity and passes the original creation options to the control plane', async () => {
        vi.useFakeTimers();
        const info = accountInfo();
        const pending = new CreateContainerStep().execute({
            ...createArmTestContext(),
            accountInfo: info,
            experience: FabricNativeExperience,
            databaseId: 'database',
            containerName: 'container',
            partitionKey: { paths: ['/tenant'] },
            throughput: 0,
            maxThroughput: 5_000,
        });
        await vi.runAllTimersAsync();
        await pending;
        expect(mocks.showCreatingChild).toHaveBeenCalledExactlyOnceWith(
            `${info.id}/database`,
            'Creating "container"…',
            expect.any(Function),
        );
        expect(getControlPlane).toHaveBeenCalledExactlyOnceWith(info);
        expect(mocks.createContainer).toHaveBeenCalledExactlyOnceWith(
            'database',
            { id: 'container', partitionKey: { paths: ['/tenant'] } },
            0,
            5_000,
        );
    });
});
