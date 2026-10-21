/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import manifest from '../../../package.json';
import labels from '../../../package.nls.json';
import { type AzureResourceMetadata } from '../../cosmosdb/AzureResourceMetadata';
import { METRIC_KEYS } from '../../panels/accountOverview/metrics/contracts';
import { ACCOUNT_OVERVIEW_TARGETS, isAccountOverviewTarget } from '../../panels/accountOverview/navigation';
import { type CosmosDBAccountResourceItem } from '../../tree/cosmosdb/CosmosDBAccountResourceItem';
import { METRIC_VIEWS } from '../../webviews/cosmosdb/AccountOverview/metrics/descriptors';
import {
    openAccountOverview,
    openAccountOverviewTarget,
    registerAccountOverviewNavigationCommands,
} from './openAccountOverview';

const mocks = vi.hoisted(() => ({
    create: vi.fn(),
    pick: vi.fn(),
    render: vi.fn(),
    register: vi.fn(),
}));

vi.mock('@microsoft/vscode-azext-utils', () => ({
    registerCommandWithTreeNodeUnwrapping: mocks.register,
}));
vi.mock('@microsoft/vscode-azureresources-api', () => ({
    AzExtResourceType: { AzureCosmosDb: 'AzureCosmosDb' },
}));
vi.mock('../../cosmosdb/AzureResourceMetadata', () => ({
    AzureResourceMetadata: { create: mocks.create },
}));
vi.mock('../../panels/AccountOverviewTab', () => ({
    AccountOverviewTab: { render: mocks.render },
}));
vi.mock('../../utils/pickItem/pickAppResource', () => ({ pickAppResource: mocks.pick }));

function createContext(): IActionContext {
    return {
        valuesToMask: [],
        telemetry: { properties: {}, measurements: {} },
    } as unknown as IActionContext;
}

function createNode(): CosmosDBAccountResourceItem {
    return {
        contextValue: 'treeItem.account/hasArmMetadata',
        experience: { api: 'SQL' },
        account: {
            id: '/subscriptions/sub/resourceGroups/group/providers/Microsoft.DocumentDB/databaseAccounts/account',
            name: 'account',
            resourceGroup: 'group',
            subscription: { subscriptionId: 'sub', tenantId: 'tenant', name: 'subscription-name' },
        },
    } as unknown as CosmosDBAccountResourceItem;
}

function createMetadata(): AzureResourceMetadata {
    return {
        accountId: 'metadata-id',
        accountName: 'metadata-name',
        resourceGroup: 'metadata-group',
        documentEndpoint: 'https://metadata.documents.azure.com',
        subscription: { subscriptionId: 'metadata-sub', tenantId: 'metadata-tenant', name: 'metadata-subscription' },
        databaseAccount: { id: 'database-id', name: 'database-name', location: 'database-region' },
    } as unknown as AzureResourceMetadata;
}

beforeEach(() => {
    vi.resetAllMocks();
    mocks.create.mockResolvedValue(createMetadata());
});

describe('account overview commands', () => {
    it('routes the original command to overview and masks values before fallible operations, excluding tenants', async () => {
        const context = createContext();
        const node = createNode();
        const metadata = createMetadata();
        mocks.create.mockImplementation(() => {
            expect(context.valuesToMask).toEqual(
                expect.arrayContaining([node.account.id, 'account', 'group', 'sub', 'subscription-name']),
            );
            expect(context.valuesToMask).not.toContain('tenant');
            return metadata;
        });
        mocks.render.mockImplementation(() => {
            expect(context.valuesToMask).toEqual(
                expect.arrayContaining([
                    'metadata-id',
                    'metadata-name',
                    'metadata-group',
                    'https://metadata.documents.azure.com',
                    'metadata-sub',
                    'metadata-subscription',
                    'database-id',
                    'database-name',
                    'database-region',
                ]),
            );
            expect(context.valuesToMask).not.toContain('metadata-tenant');
        });

        await openAccountOverview(context, node);

        expect(mocks.pick).not.toHaveBeenCalled();
        expect(mocks.create).toHaveBeenCalledWith(node.account);
        expect(mocks.render).toHaveBeenCalledExactlyOnceWith(metadata, undefined, 'overview');
        expect(context.telemetry.properties).toEqual({ experience: 'SQL' });
        expect(context.telemetry.measurements).toEqual({});
        expect(context.valuesToMask.every((value) => value.trim().length > 0)).toBe(true);
    });

    it('registers each bounded navigation destination exactly once', () => {
        registerAccountOverviewNavigationCommands();
        expect(mocks.register.mock.calls.map(([id]) => id)).toEqual(
            ACCOUNT_OVERVIEW_TARGETS.map((target) => `cosmosDB.openAccountOverview.${target}`),
        );
        expect(mocks.register).toHaveBeenCalledTimes(11);
    });

    it.each(ACCOUNT_OVERVIEW_TARGETS)('routes the registered %s command to the existing dashboard', async (target) => {
        registerAccountOverviewNavigationCommands();
        const registration = mocks.register.mock.calls.find(([id]) => id === `cosmosDB.openAccountOverview.${target}`);
        expect(registration).toBeDefined();
        const callback = registration![1] as (
            context: IActionContext,
            node?: CosmosDBAccountResourceItem,
        ) => Promise<void>;
        const node = createNode();
        const metadata = createMetadata();
        mocks.create.mockResolvedValue(metadata);

        await callback(createContext(), node);

        expect(mocks.pick).not.toHaveBeenCalled();
        expect(mocks.create).toHaveBeenCalledExactlyOnceWith(node.account);
        expect(mocks.render).toHaveBeenCalledExactlyOnceWith(metadata, undefined, target);
    });

    it.each(ACCOUNT_OVERVIEW_TARGETS)('uses the ARM account picker when opening %s without a node', async (target) => {
        const context = createContext();
        const node = createNode();
        mocks.pick.mockResolvedValue(node);
        await openAccountOverviewTarget(context, target);

        expect(mocks.pick).toHaveBeenCalledExactlyOnceWith(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: /hasarmmetadata/i,
        });
        expect(mocks.create).toHaveBeenCalledWith(node.account);
        expect(mocks.render).toHaveBeenCalledWith(expect.any(Object), undefined, target);
    });

    it('does nothing when the picker has no selection', async () => {
        const context = createContext();
        mocks.pick.mockResolvedValue(undefined);
        await expect(openAccountOverview(context)).resolves.toBeUndefined();
        expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.render).not.toHaveBeenCalled();
        expect(context.valuesToMask).toEqual([]);
        expect(context.telemetry.properties).toEqual({});
    });

    it('propagates picker rejection without loading metadata or rendering', async () => {
        const error = new Error('picker cancelled');
        mocks.pick.mockRejectedValue(error);
        await expect(openAccountOverviewTarget(createContext(), 'advisories')).rejects.toBe(error);
        expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.render).not.toHaveBeenCalled();
    });

    it('reports unavailable metadata without opening a panel', async () => {
        mocks.create.mockResolvedValue(undefined);
        await expect(openAccountOverviewTarget(createContext(), 'normalizedRu', createNode())).rejects.toThrow(
            'Failed to load Cosmos DB account metadata.',
        );
        expect(mocks.render).not.toHaveBeenCalled();
    });

    it('propagates metadata failures with account masks already registered', async () => {
        const context = createContext();
        const error = new Error('metadata unavailable');
        mocks.create.mockRejectedValue(error);
        await expect(openAccountOverviewTarget(context, 'advisories', createNode())).rejects.toBe(error);
        expect(mocks.render).not.toHaveBeenCalled();
        expect(context.valuesToMask).toEqual(expect.arrayContaining(['account', 'group', 'sub']));
        expect(context.valuesToMask).not.toContain('tenant');
    });

    it('propagates panel attachment failures rather than swallowing them', async () => {
        const error = new Error('transport unavailable');
        mocks.render.mockImplementation(() => {
            throw error;
        });
        await expect(openAccountOverview(createContext(), createNode())).rejects.toBe(error);
    });

    it('supports an account node without experience telemetry', async () => {
        const context = createContext();
        const node = { account: createNode().account } as CosmosDBAccountResourceItem;
        await openAccountOverview(context, node);
        expect(mocks.render).toHaveBeenCalledOnce();
        expect(context.telemetry.properties).toEqual({});
    });
});

describe('account overview contribution contract', () => {
    const expectedTargets = [
        'overview',
        'normalizedRu',
        'totalRequests',
        'totalRequestUnits',
        'metadataRequests',
        'serverLatency',
        'serviceAvailability',
        'dataIndexUsage',
        'provisionedThroughput',
        'documentCount',
        'advisories',
    ];
    const submenu = manifest.contributes.menus['cosmosDB.submenus.accountOverview'];
    const contributedCommands = manifest.contributes.commands.filter((entry) =>
        entry.command.startsWith('cosmosDB.openAccountOverview'),
    );
    const labelFor = (reference: string) => labels[reference.slice(1, -1) as keyof typeof labels];

    it('contains only overview, the nine existing metric keys, and advisories', () => {
        expect(ACCOUNT_OVERVIEW_TARGETS).toEqual(expectedTargets);
        expect(ACCOUNT_OVERVIEW_TARGETS).toEqual(['overview', ...METRIC_KEYS, 'advisories']);
        expect(contributedCommands.map((entry) => entry.command)).toEqual([
            'cosmosDB.openAccountOverview',
            ...expectedTargets.map((target) => `cosmosDB.openAccountOverview.${target}`),
        ]);
        for (const target of expectedTargets) {
            expect(isAccountOverviewTarget(target)).toBe(true);
        }
    });

    it.each(['throughput', 'storage', 'networking', 'keys', 'Overview', '', null, undefined, 0, {}])(
        'rejects unsupported runtime navigation target %j',
        (target) => {
            expect(isAccountOverviewTarget(target)).toBe(false);
        },
    );

    it('keeps exactly three ordered menu groups with metric labels identical to the dashboard', () => {
        expect(submenu).toEqual([
            { command: 'cosmosDB.openAccountOverview.overview', group: '1_overview@1' },
            ...METRIC_KEYS.map((key, index) => ({
                command: `cosmosDB.openAccountOverview.${key}`,
                group: `2_monitoring@${index + 1}`,
            })),
            { command: 'cosmosDB.openAccountOverview.advisories', group: '3_advisories@1' },
        ]);
        for (const key of METRIC_KEYS) {
            const command = contributedCommands.find(
                (entry) => entry.command === `cosmosDB.openAccountOverview.${key}`,
            );
            expect(command).toBeDefined();
            expect(labelFor(command!.title)).toBe(METRIC_VIEWS[key].label);
        }
        for (const [target, label] of [
            ['overview', 'Overview'],
            ['advisories', 'Advisories'],
        ]) {
            const command = contributedCommands.find(
                (entry) => entry.command === `cosmosDB.openAccountOverview.${target}`,
            );
            expect(command).toBeDefined();
            expect(labelFor(command!.title)).toBe(label);
        }
        const root = manifest.contributes.submenus.find((entry) => entry.id === 'cosmosDB.submenus.accountOverview');
        expect(root).toBeDefined();
        expect(labelFor(root!.label)).toBe('Account Overview');
    });

    it('gates the submenu to ARM metadata accounts in Azure Resources views', () => {
        const entries = manifest.contributes.menus['view/item/context'].filter(
            (entry) => 'submenu' in entry && entry.submenu === 'cosmosDB.submenus.accountOverview',
        );
        expect(entries).toHaveLength(1);
        expect(entries[0].when).toBe('view =~ /azure(ResourceGroups|FocusView)/ && viewItem =~ /hasarmmetadata/i');
        expect(
            manifest.contributes.menus['view/item/context'].filter(
                (entry) => 'command' in entry && entry.command?.startsWith('cosmosDB.openAccountOverview'),
            ),
        ).toEqual([]);
    });

    it('wires the original command and bounded shortcut registration into account commands', () => {
        const source = readFileSync(resolve(__dirname, '..', 'registerCommands.ts'), 'utf8');
        expect(source).toContain(
            "registerCommandWithTreeNodeUnwrapping('cosmosDB.openAccountOverview', openAccountOverview)",
        );
        expect(source).toMatch(/\bregisterAccountOverviewNavigationCommands\(\);/);
    });
});
