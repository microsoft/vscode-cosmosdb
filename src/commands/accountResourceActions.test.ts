/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as AzExtUtils from '@microsoft/vscode-azext-utils';
import { AzureWizard, GoBackError, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import * as vscode from 'vscode';
import { CoreExperience, FabricNativeExperience } from '../AzureDBExperiences';
import { armTestSubscription, createArmTestContext } from '../cosmosdb/armTestUtils';
import { AuthenticationMethod } from '../cosmosdb/AuthenticationMethod';
import { getControlPlane } from '../cosmosdb/controlPlane';
import { ext } from '../extensionVariables';
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
import { promptContainerNameOrDataModeler } from './createContainer/promptContainerNameOrDataModeler';
import { CosmosDBExecuteStep as CreateDatabaseStep } from './createDatabase/CosmosDBExecuteStep';
import { cosmosDBCreateDatabase, createDatabase } from './createDatabase/createDatabase';
import { type CreateDatabaseWizardContext } from './createDatabase/CreateDatabaseWizardContext';
import { promptDatabaseNameOrDataModeler } from './createDatabase/promptDatabaseNameOrDataModeler';
import { isDataModelerFeatureEnabled } from './dataModeling/dataModelerFeatureFlag';
import { openDataModelingWizard } from './dataModeling/openDataModelingWizard';

const mocks = vi.hoisted(() => ({
    prompt: vi.fn(),
    execute: vi.fn(),
    createDatabase: vi.fn(),
    createContainer: vi.fn(),
    showCreatingChild: vi.fn(async (_id: string, _label: string, action: () => Promise<void>) => action()),
    telemetryEvents: [] as Array<{ name: string; context: AzExtUtils.IActionContext }>,
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
    callWithTelemetryAndErrorHandling: vi.fn(
        async (name: string, callback: (context: AzExtUtils.IActionContext) => Promise<unknown>) => {
            const context = {
                telemetry: { properties: {}, measurements: {} },
                errorHandling: { issueProperties: {} },
                valuesToMask: [],
            } as unknown as AzExtUtils.IActionContext;
            mocks.telemetryEvents.push({ name, context });
            return callback(context);
        },
    ),
    AzureWizard: vi.fn(
        class {
            constructor(
                private readonly context: CreateContainerWizardContext | CreateDatabaseWizardContext,
                private readonly options: AzExtUtils.IWizardOptions<
                    CreateContainerWizardContext | CreateDatabaseWizardContext
                >,
            ) {}
            prompt = async () => {
                await mocks.prompt();
                if ('databaseId' in this.context) {
                    const nameStep = this.options.promptSteps?.[0];
                    if (nameStep?.getSubWizard) {
                        await nameStep.prompt(this.context);
                        return;
                    }
                    this.context.containerName ??= 'new-container';
                } else {
                    this.context.databaseName ??= 'new-database';
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
        isAIFeaturesEnabled: false,
        state: { showCreatingChild: mocks.showCreatingChild },
        get cosmosDBBranchDataProvider() {
            throw new Error('Creating resources must not look up Explorer nodes.');
        },
    },
}));
vi.mock('../utils/dialogs/showConfirmation', () => ({ showConfirmationAsInSettings: vi.fn() }));
vi.mock('../utils/pickItem/pickAppResource', () => ({ pickAppResource: vi.fn() }));
vi.mock('./dataModeling/dataModelerFeatureFlag', () => ({ isDataModelerFeatureEnabled: vi.fn() }));
vi.mock('./dataModeling/openDataModelingWizard', () => ({ openDataModelingWizard: vi.fn() }));
vi.mock('./createDatabase/promptDatabaseNameOrDataModeler', () => ({ promptDatabaseNameOrDataModeler: vi.fn() }));
vi.mock('./createContainer/promptContainerNameOrDataModeler', () => ({ promptContainerNameOrDataModeler: vi.fn() }));

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
    ext.isAIFeaturesEnabled = false;
    vi.mocked(isDataModelerFeatureEnabled).mockReset().mockReturnValue(true);
    vi.mocked(openDataModelingWizard).mockReset();
    vi.mocked(promptDatabaseNameOrDataModeler).mockReset();
    vi.mocked(promptContainerNameOrDataModeler).mockReset();
    mocks.telemetryEvents.length = 0;
});

afterEach(() => {
    vi.useRealTimers();
});

async function useRealContainerWizard() {
    const actual = await vi.importActual<typeof AzExtUtils>('@microsoft/vscode-azext-utils');
    vi.mocked(AzureWizard).mockImplementationOnce(function (context, options) {
        return new actual.AzureWizard(context, options);
    });
    const execute = vi.spyOn(actual.AzureWizard.prototype, 'execute').mockResolvedValue();
    const completed = new vscode.EventEmitter<AzExtUtils.PromptResult>();
    const context = createArmTestContext();
    context.ui = { ...context.ui, onDidFinishPrompt: completed.event };
    const picks: Array<{
        buttons: readonly vscode.QuickInputButton[];
        hide: () => void;
    }> = [];
    const disposables: vscode.Disposable[] = [completed];
    const createQuickPick = vi.spyOn(vscode.window, 'createQuickPick').mockImplementation(() => {
        const hidden = new vscode.EventEmitter<void>();
        disposables.push(hidden);
        const unusedEvent = () => ({ dispose: vi.fn() });
        const pick = {
            value: '',
            title: undefined,
            step: undefined,
            totalSteps: undefined,
            placeholder: undefined,
            prompt: undefined,
            enabled: true,
            busy: false,
            ignoreFocusOut: false,
            canSelectMany: false,
            matchOnDescription: false,
            matchOnDetail: false,
            items: [],
            activeItems: [],
            selectedItems: [],
            buttons: [] as readonly vscode.QuickInputButton[],
            onDidHide: hidden.event,
            onDidChangeValue: unusedEvent,
            onDidAccept: unusedEvent,
            onDidTriggerButton: unusedEvent,
            onDidTriggerItemButton: unusedEvent,
            onDidChangeActive: unusedEvent,
            onDidChangeSelection: unusedEvent,
            show: vi.fn(),
            hide: () => hidden.fire(),
            dispose: vi.fn(),
        } satisfies vscode.QuickPick<vscode.QuickPickItem>;
        picks.push(pick);
        return pick;
    });
    onTestFinished(() => {
        execute.mockRestore();
        createQuickPick.mockRestore();
        disposables.forEach((disposable) => {
            disposable.dispose();
        });
    });
    return { context, completed, execute, picks };
}

describe('container wizard Back navigation', () => {
    it.each(['partition key', 'throughput'])(
        'returns from %s to edit the name and rebuilds the remaining steps',
        async (from) => {
            ext.isAIFeaturesEnabled = true;
            const { context, completed, execute, picks } = await useRealContainerWizard();
            const info = accountInfo();
            const names = ['original', 'corrected'];
            vi.mocked(promptContainerNameOrDataModeler).mockImplementation(async () => {
                // Opening the custom picker hides the wizard's loading picker without cancelling the wizard.
                picks.at(-1)?.hide();
                const name = names.shift();
                if (!name) throw new Error('Unexpected extra name prompt');
                return { kind: 'manual', name };
            });
            const answers =
                from === 'throughput'
                    ? ['/oldKey', '', new GoBackError(), new GoBackError(), new GoBackError(), '/tenant', '', '400']
                    : [new GoBackError(), '/tenant', '', '400'];
            vi.spyOn(context.ui, 'showInputBox').mockImplementation(async () => {
                expect(picks.at(-1)?.buttons).toContain(vscode.QuickInputButtons.Back);
                const answer = answers.shift();
                if (answer instanceof Error) throw answer;
                if (answer === undefined) throw new Error('Unexpected extra prompt');
                completed.fire({ value: answer });
                return answer;
            });

            await createContainer(context, info, 'db', CoreExperience);

            expect(promptContainerNameOrDataModeler).toHaveBeenNthCalledWith(1, info, 'db', '');
            expect(promptContainerNameOrDataModeler).toHaveBeenNthCalledWith(2, info, 'db', 'original');
            expect(answers).toEqual([]);
            expect(execute).toHaveBeenCalledOnce();
            expect(showConfirmationAsInSettings).toHaveBeenCalledExactlyOnceWith(
                'The "corrected" container has been created.',
            );
            expect(context.valuesToMask).toEqual(expect.arrayContaining(['original', 'corrected', '/tenant']));
            expect(openDataModelingWizard).not.toHaveBeenCalled();
        },
    );

    it('can switch to Data Modeler after going Back without prompting for keys or executing creation', async () => {
        ext.isAIFeaturesEnabled = true;
        const { context, execute } = await useRealContainerWizard();
        const info = accountInfo();
        vi.mocked(promptContainerNameOrDataModeler)
            .mockResolvedValueOnce({ kind: 'manual', name: 'original' })
            .mockResolvedValueOnce({ kind: 'dataModeler' });
        const input = vi.spyOn(context.ui, 'showInputBox').mockRejectedValue(new GoBackError());

        await createContainer(context, info, 'selected-db', CoreExperience);

        expect(input).toHaveBeenCalledOnce();
        expect(execute).not.toHaveBeenCalled();
        expect(openDataModelingWizard).toHaveBeenCalledExactlyOnceWith(context, info, 'selected-db');
        expect(mocks.telemetryEvents.map(({ context: event }) => event.telemetry.properties)).toEqual([
            { entryPoint: 'createContainer' },
        ]);
        expect(showConfirmationAsInSettings).not.toHaveBeenCalled();
    });

    it('propagates cancellation after returning to the name', async () => {
        ext.isAIFeaturesEnabled = true;
        const { context, execute } = await useRealContainerWizard();
        const cancelled = new UserCancelledError();
        vi.mocked(promptContainerNameOrDataModeler)
            .mockResolvedValueOnce({ kind: 'manual', name: 'original' })
            .mockRejectedValueOnce(cancelled);
        vi.spyOn(context.ui, 'showInputBox').mockRejectedValue(new GoBackError());

        await expect(createContainer(context, accountInfo(), 'db', CoreExperience)).rejects.toBe(cancelled);

        expect(execute).not.toHaveBeenCalled();
        expect(openDataModelingWizard).not.toHaveBeenCalled();
        expect(mocks.telemetryEvents).toEqual([]);
        expect(showConfirmationAsInSettings).not.toHaveBeenCalled();
    });
});

describe('shared creation wizards', () => {
    it('keeps the typed container name and continues the partition key and throughput wizard', async () => {
        ext.isAIFeaturesEnabled = true;
        const context = createArmTestContext();
        const info = accountInfo();
        vi.mocked(promptContainerNameOrDataModeler).mockResolvedValue({ kind: 'manual', name: 'typed-container' });

        await createContainer(context, info, 'selected-db', CoreExperience);

        expect(promptContainerNameOrDataModeler).toHaveBeenCalledExactlyOnceWith(info, 'selected-db', '');
        expect(AzureWizard).toHaveBeenCalledWith(
            expect.objectContaining({ databaseId: 'selected-db', containerName: 'typed-container' }),
            expect.objectContaining({
                promptSteps: [expect.objectContaining({ id: 'cosmosDB.createContainer.nameStep' })],
            }),
        );
        expect(mocks.execute).toHaveBeenCalledOnce();
        expect(context.valuesToMask).toContain('typed-container');
        expect(mocks.telemetryEvents).toEqual([]);
        expect(showConfirmationAsInSettings).toHaveBeenCalledWith('The "typed-container" container has been created.');
    });

    it.each([undefined, new Error('Modeler failed')])(
        'records the container entry point and passes its database even if launching fails: %s',
        async (failure) => {
            ext.isAIFeaturesEnabled = true;
            const context = createArmTestContext();
            const info = accountInfo();
            vi.mocked(promptContainerNameOrDataModeler).mockResolvedValue({ kind: 'dataModeler' });
            if (failure) vi.mocked(openDataModelingWizard).mockRejectedValue(failure);
            const result = createContainer(context, info, 'selected-db', CoreExperience);
            await expect(result.catch((error: unknown) => error)).resolves.toBe(failure);

            expect(openDataModelingWizard).toHaveBeenCalledExactlyOnceWith(context, info, 'selected-db');
            expect(mocks.execute).not.toHaveBeenCalled();
            expect(showConfirmationAsInSettings).not.toHaveBeenCalled();
            expect(mocks.telemetryEvents).toHaveLength(1);
            expect(mocks.telemetryEvents[0].name).toBe('cosmosDB.dataModeler.entryPointSelected');
            expect(mocks.telemetryEvents[0].context.telemetry.properties).toEqual({ entryPoint: 'createContainer' });
            expect(mocks.telemetryEvents[0].context.errorHandling).toMatchObject({
                suppressDisplay: true,
                rethrow: false,
            });
        },
    );

    it('cancels the container choice without creating resources or recording a click', async () => {
        ext.isAIFeaturesEnabled = true;
        const error = new UserCancelledError();
        vi.mocked(promptContainerNameOrDataModeler).mockRejectedValue(error);
        await expect(createContainer(createArmTestContext(), accountInfo(), 'db', CoreExperience)).rejects.toBe(error);
        expect(mocks.execute).not.toHaveBeenCalled();
        expect(openDataModelingWizard).not.toHaveBeenCalled();
        expect(mocks.telemetryEvents).toEqual([]);
    });

    it.each([
        [CoreExperience, false, true],
        [CoreExperience, true, false],
        [FabricNativeExperience, true, true],
    ] as const)('preserves the plain container flow when unavailable: %j, %s, %s', async (experience, ai, modeler) => {
        ext.isAIFeaturesEnabled = ai;
        vi.mocked(isDataModelerFeatureEnabled).mockReturnValue(modeler);
        await createContainer(createArmTestContext(), accountInfo(), 'db', experience);
        expect(promptContainerNameOrDataModeler).not.toHaveBeenCalled();
        expect(mocks.execute).toHaveBeenCalledOnce();
    });

    it('creates the database named in the combined prompt without prompting again', async () => {
        ext.isAIFeaturesEnabled = true;
        const context = createArmTestContext();
        const info = accountInfo();
        vi.mocked(promptDatabaseNameOrDataModeler).mockResolvedValue({ kind: 'manual', databaseName: 'typed-db' });

        await createDatabase(context, info, CoreExperience);

        expect(promptDatabaseNameOrDataModeler).toHaveBeenCalledExactlyOnceWith(info);
        expect(AzureWizard).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ accountInfo: info, databaseName: 'typed-db' }),
            expect.anything(),
        );
        expect(mocks.execute).toHaveBeenCalledOnce();
        expect(openDataModelingWizard).not.toHaveBeenCalled();
        expect(context.valuesToMask).toContain('typed-db');
        expect(context.telemetry.properties.creationChoice).toBe('manual');
        expect(mocks.telemetryEvents).toEqual([]);
        expect(showConfirmationAsInSettings).toHaveBeenCalledExactlyOnceWith(
            'The "typed-db" database has been created.',
        );
    });

    it('opens Data Modeler for the selected account without creating a database', async () => {
        ext.isAIFeaturesEnabled = true;
        const context = createArmTestContext();
        const info = accountInfo();
        vi.mocked(promptDatabaseNameOrDataModeler).mockResolvedValue({ kind: 'dataModeler' });

        await createDatabase(context, info, CoreExperience);

        expect(openDataModelingWizard).toHaveBeenCalledExactlyOnceWith(context, info);
        expect(context.telemetry.properties.creationChoice).toBe('dataModeler');
        expect(mocks.telemetryEvents).toHaveLength(1);
        const [{ name, context: event }] = mocks.telemetryEvents;
        expect(name).toBe('cosmosDB.dataModeler.entryPointSelected');
        expect(event.telemetry.properties).toEqual({ entryPoint: 'createDatabase' });
        expect(event.errorHandling).toMatchObject({ suppressDisplay: true, rethrow: false });
        expect(AzureWizard).not.toHaveBeenCalled();
        expect(showConfirmationAsInSettings).not.toHaveBeenCalled();
        expect(pickAppResource).not.toHaveBeenCalled();
    });

    it.each([
        [CoreExperience, false, true],
        [CoreExperience, true, false],
        [FabricNativeExperience, true, true],
    ] as const)(
        'uses the plain name prompt when unavailable: %j, AI=%s, modeler=%s',
        async (experience, ai, modeler) => {
            ext.isAIFeaturesEnabled = ai;
            vi.mocked(isDataModelerFeatureEnabled).mockReturnValue(modeler);

            await createDatabase(createArmTestContext(), accountInfo(), experience);

            expect(promptDatabaseNameOrDataModeler).not.toHaveBeenCalled();
            expect(mocks.prompt).toHaveBeenCalledOnce();
            expect(mocks.execute).toHaveBeenCalledOnce();
            expect(openDataModelingWizard).not.toHaveBeenCalled();
        },
    );

    it('propagates prompt cancellation without starting either workflow', async () => {
        ext.isAIFeaturesEnabled = true;
        const cancellation = new UserCancelledError();
        vi.mocked(promptDatabaseNameOrDataModeler).mockRejectedValue(cancellation);

        await expect(createDatabase(createArmTestContext(), accountInfo(), CoreExperience)).rejects.toBe(cancellation);

        expect(AzureWizard).not.toHaveBeenCalled();
        expect(openDataModelingWizard).not.toHaveBeenCalled();
        expect(showConfirmationAsInSettings).not.toHaveBeenCalled();
    });

    it.each([new UserCancelledError(), new Error('Data Modeler failed')])(
        'propagates Data Modeler errors without falling back to database creation: %s',
        async (error) => {
            ext.isAIFeaturesEnabled = true;
            vi.mocked(promptDatabaseNameOrDataModeler).mockResolvedValue({ kind: 'dataModeler' });
            vi.mocked(openDataModelingWizard).mockRejectedValue(error);

            await expect(createDatabase(createArmTestContext(), accountInfo(), CoreExperience)).rejects.toBe(error);

            expect(mocks.telemetryEvents.map((event) => event.name)).toEqual([
                'cosmosDB.dataModeler.entryPointSelected',
            ]);
            expect(AzureWizard).not.toHaveBeenCalled();
            expect(showConfirmationAsInSettings).not.toHaveBeenCalled();
        },
    );

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
