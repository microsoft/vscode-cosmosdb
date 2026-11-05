/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type WorkspaceResource } from '@microsoft/vscode-azureresources-api';
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { createArmTestContext } from '../cosmosdb/armTestUtils';
import { BaseCachedBranchDataProvider } from './BaseCachedBranchDataProvider';
import { type TreeElement } from './TreeElement';

vi.mock('../utils/azureClients', () => ({}));
vi.mock('../extensionVariables', () => ({
    ext: { state: { wrapItemInStateHandling: (item: TreeElement) => item } },
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    UserCancelledError: class extends Error {
        _isUserCancelledError = true;
    },
    callWithTelemetryAndErrorHandling: async (_name: string, callback: (context: IActionContext) => unknown) => {
        const context = createArmTestContext();
        try {
            return await callback(context);
        } catch (error) {
            // Model the SDK behavior that consumes cancellation even with rethrow enabled.
            if (
                error instanceof vscode.CancellationError ||
                (typeof error === 'object' && error !== null && '_isUserCancelledError' in error)
            ) {
                return undefined;
            }
            if (context.errorHandling.rethrow) {
                throw error;
            }
            return undefined;
        }
    },
    callWithTelemetryAndErrorHandlingSync: (_name: string, callback: (context: IActionContext) => unknown) =>
        callback(createArmTestContext()),
    parseError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
    createGenericElement: (options: { id: string; label: string }) => ({
        id: options.id,
        getTreeItem: () => ({ label: options.label }),
    }),
}));

interface IdentityResource extends WorkspaceResource {
    identity: string;
}

interface IdentityNode extends TreeElement {
    identity: string;
}

class TestProvider extends BaseCachedBranchDataProvider<IdentityResource> {
    protected readonly providerName = 'TestProvider';
    protected readonly contextValue = 'test';
    public loadingError?: Error;
    public renderingError?: Error;
    public creationError?: Error;

    protected createResourceItem(_context: IActionContext, resource?: IdentityResource): IdentityNode {
        if (this.creationError) {
            throw this.creationError;
        }
        if (!resource) {
            throw new Error('Missing fixture resource');
        }
        return {
            id: resource.id,
            identity: resource.identity,
            getTreeItem: () => {
                if (this.renderingError) {
                    throw this.renderingError;
                }
                return { label: resource.name };
            },
            getChildren: () => {
                if (this.loadingError) {
                    throw this.loadingError;
                }
                return [
                    {
                        id: `${resource.id}/db/items`,
                        identity: resource.identity,
                        getTreeItem: () => ({ label: 'items' }),
                    },
                ];
            },
        };
    }
}

const resource: IdentityResource = { id: '/account', name: 'Account', resourceType: 'test', identity: 'selected' };

describe('BaseCachedBranchDataProvider explicit operations', () => {
    it('keeps parent identity even after another identity replaces the unqualified cache', async () => {
        const provider = new TestProvider();
        const selected = await provider.getResourceItem(resource);
        const [child] = await provider.getChildren(selected);
        const other = await provider.getResourceItem({ ...resource, identity: 'other' });
        await provider.getChildren(other);
        expect(provider.getParent(child)).toBe(selected);
        expect(provider.getParent(child)).not.toBe(other);
    });

    it.each(['user', 'VS Code', 'ordinary'])('propagates %s loading errors for explicit operations', async (kind) => {
        const provider = new TestProvider();
        const node = await provider.getResourceItem(resource);
        const error =
            kind === 'user'
                ? new UserCancelledError()
                : kind === 'VS Code'
                  ? new vscode.CancellationError()
                  : new Error('Loading failed');
        provider.loadingError = error;
        await expect(provider.getChildren(node, { propagateErrors: true })).rejects.toBe(error);
        const browsing = await provider.getChildren(node);
        expect(browsing).toHaveLength(kind === 'ordinary' ? 1 : 0);
        expect(browsing.map((item) => item.id.includes('/error-'))).toEqual(kind === 'ordinary' ? [true] : []);
    });

    it('preserves cancellation thrown during the parent tree-item telemetry lookup', async () => {
        const provider = new TestProvider();
        const node = await provider.getResourceItem(resource);
        provider.renderingError = new UserCancelledError();
        await expect(provider.getChildren(node, { propagateErrors: true })).rejects.toBe(provider.renderingError);
    });

    it.each(['user', 'ordinary'])(
        'propagates %s resource-creation failures without changing browsing',
        async (kind) => {
            const provider = new TestProvider();
            provider.creationError = kind === 'user' ? new UserCancelledError() : new Error('Creation failed');
            await expect(provider.getResourceItem(resource, { propagateErrors: true })).rejects.toBe(
                provider.creationError,
            );
            const browsing = await provider.getResourceItem(resource);
            expect(browsing.id).toContain('error-');
        },
    );
});
