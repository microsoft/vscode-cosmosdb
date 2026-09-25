/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type GenericElementOptions, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type WorkspaceResource } from '@microsoft/vscode-azureresources-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ext } from '../extensionVariables';
import { BaseCachedBranchDataProvider } from './BaseCachedBranchDataProvider';
import { getTreeErrorMessage } from './getTreeErrorMessage';
import { type TreeElement } from './TreeElement';

vi.mock('@microsoft/vscode-azext-utils', () => {
    const run = (_name: string, callback: (context: IActionContext) => unknown) =>
        callback({
            errorHandling: { issueProperties: {} },
            telemetry: { properties: {}, measurements: {} },
            valuesToMask: [],
            get ui(): never {
                throw new Error('Unexpected user input');
            },
        });
    return {
        callWithTelemetryAndErrorHandling: vi.fn(run),
        callWithTelemetryAndErrorHandlingSync: vi.fn(run),
        parseError: (error: unknown) => ({
            message:
                typeof error === 'object' && error !== null && 'message' in error
                    ? String(error.message)
                    : String(error),
        }),
        createGenericElement: (options: GenericElementOptions): TreeElement => ({
            id: options.id ?? '',
            getTreeItem: () => ({
                id: options.id,
                label: options.label,
                tooltip: options.tooltip,
                contextValue: options.contextValue,
                command: {
                    command: options.commandId ?? '',
                    title: '',
                    arguments: options.commandArgs,
                },
            }),
        }),
    };
});
vi.mock('../extensionVariables', () => ({
    ext: {
        outputChannel: { error: vi.fn(), debug: vi.fn(), show: vi.fn() },
        state: { wrapItemInStateHandling: vi.fn((item: TreeElement) => item) },
    },
}));

class TestProvider extends BaseCachedBranchDataProvider<WorkspaceResource> {
    protected get providerName(): string {
        return 'TestProvider';
    }
    protected get contextValue(): string {
        return 'cosmosDB.workspace';
    }
    public factory = vi.fn<() => TreeElement | undefined>();
    protected createResourceItem(): TreeElement | undefined {
        return this.factory();
    }
}

describe('tree error messages', () => {
    it.each([
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'SELF_SIGNED_CERT_IN_CHAIN',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    ])('provides extension-specific guidance for %s', (code) => {
        const error = Object.assign(
            new Error('unable to verify the first certificate; try running Node.js with --use-system-ca'),
            { code },
        );
        const message = getTreeErrorMessage(error);
        expect(message).toContain(code);
        expect(message).toContain('"New Emulator Connection" under "Local Emulators"');
        expect(message).toContain('For other connections');
        expect(message).toContain('Do not disable certificate validation globally');
        expect(message).not.toContain('--use-system-ca');
    });

    it('recognizes certificate errors wrapped in a cause', () => {
        const error = new Error('Request failed', {
            cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN', message: 'self signed certificate in certificate chain' },
        });
        expect(getTreeErrorMessage(error)).toContain('TLS certificate verification failed');
    });

    it('leaves other errors, including expired certificates, unchanged', () => {
        expect(getTreeErrorMessage(new Error('Connection timed out'))).toBe('Connection timed out');
        expect(getTreeErrorMessage({ code: 'CERT_HAS_EXPIRED', message: 'certificate has expired' })).toBe(
            'certificate has expired',
        );
        expect(getTreeErrorMessage('String error')).toBe('String error');
    });

    it('handles circular causes without looping', () => {
        const error = new Error('Cyclic cause');
        error.cause = error;
        expect(getTreeErrorMessage(error)).toBe('Cyclic cause');
    });
});

describe('BaseCachedBranchDataProvider error nodes', () => {
    let provider: TestProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new TestProvider();
    });

    it('logs child failures and makes clicking the error node open the output log', async () => {
        const error = new Error('First line\nSecond line');
        const children = await provider.getChildren({
            id: 'account',
            getTreeItem: () => ({ label: 'Account' }),
            getChildren: () => {
                throw error;
            },
        });
        expect(children).toHaveLength(1);
        const item = await children[0].getTreeItem();
        expect(item.label).toBe('Error: First line\nSecond line');
        expect(item.tooltip).toContain('First line\nSecond line');
        expect(item.contextValue).toContain('item.error');
        expect(item.command).toMatchObject({
            command: 'cosmosDB.showTreeError',
        });
        expect(item.command?.arguments).toBeUndefined();
        expect(ext.outputChannel.error).toHaveBeenCalledWith(item.label);
        expect(ext.outputChannel.debug).toHaveBeenCalledWith(error.stack);
        expect(ext.outputChannel.show).not.toHaveBeenCalled();
    });

    it('normalizes certificate errors even when the connection is not marked as an emulator', async () => {
        const element = {
            id: 'attached-account',
            isEmulator: false,
            getTreeItem: () => ({ label: 'Attached account' }),
            getChildren: () => {
                throw Object.assign(new Error('unable to verify the first certificate; --use-system-ca'), {
                    code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
                });
            },
        };
        const [child] = await provider.getChildren(element);
        const item = await child.getTreeItem();
        expect(item.label).toContain('New Emulator Connection');
        expect(item.label).not.toContain('--use-system-ca');
        expect(ext.outputChannel.error).toHaveBeenCalledWith(item.label);
    });

    it('logs resource creation failures and makes them inspectable', async () => {
        provider.factory.mockImplementation(() => {
            throw new Error('Resource creation failed');
        });
        const resource = { id: 'account', name: 'Account', resourceType: 'test' };
        const item = await (await provider.getResourceItem(resource)).getTreeItem();
        expect(item.label).toBe('Error creating resource: Resource creation failed');
        expect(ext.outputChannel.error).toHaveBeenCalledWith(item.label);
        expect(item.command?.command).toBe('cosmosDB.showTreeError');
    });

    it('preserves successful children and parent lookups without logging errors', async () => {
        const child: TreeElement = { id: 'account/database', getTreeItem: () => ({ label: 'Database' }) };
        const parent: TreeElement = {
            id: 'account',
            getTreeItem: () => ({ label: 'Account' }),
            getChildren: () => [child],
        };
        provider.factory.mockReturnValue(parent);
        await provider.getResourceItem({ id: 'account', name: 'Account', resourceType: 'test' });
        expect(await provider.getChildren(parent)).toEqual([child]);
        expect(provider.getParent(child)).toBe(parent);
        expect(ext.outputChannel.error).not.toHaveBeenCalled();
    });

    it('returns no children for leaf nodes', async () => {
        expect(await provider.getChildren({ id: 'leaf', getTreeItem: () => ({ label: 'Leaf' }) })).toEqual([]);
        expect(ext.outputChannel.error).not.toHaveBeenCalled();
    });
});
