/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureResource } from '@microsoft/vscode-azureresources-api';
import { vi } from 'vitest';
import { BaseCachedBranchDataProvider } from './BaseCachedBranchDataProvider';
import { type TreeElement } from './TreeElement';

const { failures, contexts, logError } = vi.hoisted(() => ({
    failures: [] as unknown[],
    contexts: [] as IActionContext[],
    logError: vi.fn(),
}));

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: async (_name: string, callback: (context: IActionContext) => unknown) => {
        const context = {
            errorHandling: {},
            telemetry: { properties: {} },
            valuesToMask: [],
        } as unknown as IActionContext;
        contexts.push(context);
        try {
            return await callback(context);
        } catch (error) {
            failures.push(error);
            if (context.errorHandling.rethrow) throw error;
            return undefined;
        }
    },
    callWithTelemetryAndErrorHandlingSync: (_name: string, callback: (context: IActionContext) => unknown) =>
        callback({ errorHandling: {}, telemetry: { properties: {} } } as IActionContext),
    createGenericElement: (options: { id: string; label: string; commandId: string }) => ({
        id: options.id,
        getTreeItem: () => ({ label: options.label, command: { command: options.commandId } }),
    }),
    parseError: (error: Error) => error,
}));

vi.mock('../extensionVariables', () => ({
    ext: {
        outputChannel: { error: logError },
        state: { wrapItemInStateHandling: (item: unknown) => item },
    },
}));

class TestProvider extends BaseCachedBranchDataProvider<AzureResource> {
    protected get providerName() {
        return 'TestProvider';
    }
    protected get contextValue() {
        return 'test';
    }
    public createItem = vi.fn<(context: IActionContext, resource?: AzureResource) => TreeElement>();
    protected createResourceItem(context: IActionContext, resource?: AzureResource) {
        return this.createItem(context, resource);
    }
    protected onResourceItemRetrieved() {}
}

describe('BaseCachedBranchDataProvider error boundary', () => {
    beforeEach(() => {
        failures.length = 0;
        contexts.length = 0;
        logError.mockClear();
    });

    it('reports construction failures before returning an actionable error node', async () => {
        const provider = new TestProvider();
        const failure = new Error('Internal error: missing resource metadata');
        provider.createItem.mockImplementation(() => {
            throw failure;
        });
        const node = await provider.getResourceItem({ id: 'private-id', name: 'private-name' } as AzureResource);

        expect(failures).toEqual([failure]);
        expect(contexts[0].errorHandling).toMatchObject({ suppressDisplay: true, rethrow: true });
        expect(contexts[0].valuesToMask).toEqual(['private-id', 'private-name']);
        expect(logError).toHaveBeenCalledTimes(2);
        expect(logError).toHaveBeenLastCalledWith(failure);
        expect(await node.getTreeItem()).toMatchObject({
            label: 'Unable to load resource. Check the Azure Cosmos DB output for details.',
            command: { command: 'cosmosDB.showOutput' },
        });
        expect(logError.mock.calls[0]).not.toContain('private-');
        provider.dispose();
    });

    it('still returns and caches valid resources', async () => {
        const provider = new TestProvider();
        const item = { id: 'valid', getTreeItem: () => ({ label: 'valid' }) } as TreeElement;
        provider.createItem.mockReturnValue(item);
        expect(await provider.getResourceItem({ id: 'valid', name: 'valid' } as AzureResource)).toBe(item);
        expect(await provider.findNodeById('valid')).toBe(item);
        expect(failures).toEqual([]);
        expect(logError).not.toHaveBeenCalled();
        provider.dispose();
    });

    it('reports child-loading failures and offers the output action', async () => {
        const provider = new TestProvider();
        const failure = new Error('Missing child metadata');
        const parent: TreeElement = {
            id: 'parent',
            getTreeItem: () => ({ label: 'Parent' }),
            getChildren: async () => {
                throw failure;
            },
        };
        const children = await provider.getChildren(parent);
        expect(failures).toEqual([failure]);
        expect(logError).toHaveBeenCalledTimes(2);
        expect(logError).toHaveBeenLastCalledWith(failure);
        expect(children).toHaveLength(1);
        expect(await children[0].getTreeItem()).toMatchObject({
            label: 'Unable to load resources. Check the Azure Cosmos DB output for details.',
            command: { command: 'cosmosDB.showOutput' },
        });
        provider.dispose();
    });
});
