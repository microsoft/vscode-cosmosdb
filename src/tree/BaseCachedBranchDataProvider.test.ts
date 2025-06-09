/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureResource } from '@microsoft/vscode-azureresources-api';
import { BaseCachedBranchDataProvider } from '../tree/BaseCachedBranchDataProvider';
import { type TreeElement } from '../tree/TreeElement';

// Mock the telemetry framework
jest.mock('@microsoft/vscode-azext-utils', () => ({
    ...jest.requireActual('@microsoft/vscode-azext-utils'),
    callWithTelemetryAndErrorHandling: jest.fn(async (_telemetryId: string, callback: any) => {
        const mockContext: IActionContext = {
            telemetry: { properties: {} },
            errorHandling: {
                suppressDisplay: false,
                rethrow: false,
                forceIncludeInReportIssueCommand: false,
            },
            valuesToMask: [],
        } as any;
        return await callback(mockContext);
    }),
    parseError: jest.fn((error: any) => ({
        message: error instanceof Error ? error.message : String(error),
    })),
    createGenericElement: jest.fn((options: any) => ({
        id: options.id,
        getTreeItem: jest.fn().mockResolvedValue({
            contextValue: options.contextValue,
            label: options.label,
            command: options.commandId ? {
                command: options.commandId,
                title: options.label,
                arguments: options.commandArgs,
            } : undefined,
        }),
    })),
    createContextValue: jest.fn((values: string[]) => values.join('.')),
}));

// Mock the extension variables
jest.mock('../extensionVariables', () => ({
    ext: {
        state: {
            wrapItemInStateHandling: jest.fn((item) => item),
        },
    },
}));

// Mock implementations for testing
class MockBranchDataProvider extends BaseCachedBranchDataProvider<AzureResource> {
    protected get contextValue(): string {
        return 'mock.test';
    }

    protected createResourceItem(_context: IActionContext, _resource?: AzureResource): TreeElement | undefined {
        return {
            id: 'mock-resource',
            getTreeItem: jest.fn().mockResolvedValue({}),
        } as unknown as TreeElement;
    }

    // Expose protected methods for testing
    public getErrorNodeCacheSize(): number {
        return (this as any).errorNodeCache.size;
    }

    public hasErrorNodeCached(elementId: string): boolean {
        return (this as any).errorNodeCache.has(elementId);
    }

    public getErrorNodes(elementId: string): TreeElement[] | undefined {
        return (this as any).errorNodeCache.get(elementId);
    }
}

describe('BaseCachedBranchDataProvider Error Caching', () => {
    let provider: MockBranchDataProvider;
    let mockElement: TreeElement;

    beforeEach(() => {
        provider = new MockBranchDataProvider();
        mockElement = {
            id: 'test-element',
            getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'mock.test' }),
            getChildren: jest.fn(),
        } as unknown as TreeElement;
    });

    afterEach(() => {
        provider.dispose();
    });

    describe('error node caching on exceptions', () => {
        test('should cache error nodes when getChildren throws', async () => {
            // Mock getChildren to throw an error
            (mockElement.getChildren as jest.Mock).mockRejectedValue(new Error('Connection failed'));

            const children = await provider.getChildren(mockElement);

            // Should return error nodes
            expect(children).toHaveLength(2); // Error message + retry button
            expect(children[0]).toHaveProperty('id', expect.stringContaining('/error-'));
            expect(children[1]).toHaveProperty('id', 'test-element/reconnect');

            // Should cache the error nodes
            expect(provider.hasErrorNodeCached('test-element')).toBe(true);
            expect(provider.getErrorNodes('test-element')).toEqual(children);
        });

        test('should return cached error nodes on subsequent calls', async () => {
            // Mock getChildren to throw an error
            (mockElement.getChildren as jest.Mock).mockRejectedValue(new Error('Connection failed'));

            // First call
            const firstCall = await provider.getChildren(mockElement);
            
            // Second call should return cached results
            const secondCall = await provider.getChildren(mockElement);

            expect(firstCall).toEqual(secondCall);
            expect(mockElement.getChildren).toHaveBeenCalledTimes(1); // Should only call once due to caching
        });
    });

    describe('error node caching with hasRetryNode', () => {
        test('should cache error nodes when children contain retry nodes', async () => {
            const retryChild = {
                id: 'test-element/reconnect',
                getTreeItem: jest.fn().mockResolvedValue({}),
            } as unknown as TreeElement;

            const errorChild = {
                id: 'test-element/error',
                getTreeItem: jest.fn().mockResolvedValue({}),
            } as unknown as TreeElement;

            // Mock getChildren to return children with a retry node
            (mockElement.getChildren as jest.Mock).mockResolvedValue([errorChild, retryChild]);

            const children = await provider.getChildren(mockElement);

            // Should return the children and cache them as error nodes
            expect(children).toHaveLength(2);
            expect(provider.hasErrorNodeCached('test-element')).toBe(true);
        });

        test('should not cache normal children without retry nodes', async () => {
            const normalChild = {
                id: 'test-element/normal',
                getTreeItem: jest.fn().mockResolvedValue({}),
            } as unknown as TreeElement;

            // Mock getChildren to return normal children
            (mockElement.getChildren as jest.Mock).mockResolvedValue([normalChild]);

            const children = await provider.getChildren(mockElement);

            // Should return the children but not cache them as error nodes
            expect(children).toHaveLength(1);
            expect(provider.hasErrorNodeCached('test-element')).toBe(false);
        });
    });

    describe('resetNodeErrorState', () => {
        test('should clear error state for specific node', async () => {
            // Setup error state
            (mockElement.getChildren as jest.Mock).mockRejectedValue(new Error('Connection failed'));
            await provider.getChildren(mockElement);
            
            expect(provider.hasErrorNodeCached('test-element')).toBe(true);

            // Reset error state
            provider.resetNodeErrorState('test-element');

            expect(provider.hasErrorNodeCached('test-element')).toBe(false);
        });

        test('should not affect other cached error nodes', async () => {
            const anotherElement = {
                id: 'another-element',
                getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'mock.test' }),
                getChildren: jest.fn().mockRejectedValue(new Error('Another error')),
            } as unknown as TreeElement;

            // Setup error state for both elements
            (mockElement.getChildren as jest.Mock).mockRejectedValue(new Error('Connection failed'));
            await provider.getChildren(mockElement);
            await provider.getChildren(anotherElement);
            
            expect(provider.getErrorNodeCacheSize()).toBe(2);

            // Reset only one element
            provider.resetNodeErrorState('test-element');

            expect(provider.hasErrorNodeCached('test-element')).toBe(false);
            expect(provider.hasErrorNodeCached('another-element')).toBe(true);
            expect(provider.getErrorNodeCacheSize()).toBe(1);
        });
    });

    describe('refresh behavior', () => {
        test('should clear error cache on full refresh', async () => {
            // Setup error state
            (mockElement.getChildren as jest.Mock).mockRejectedValue(new Error('Connection failed'));
            await provider.getChildren(mockElement);
            
            expect(provider.hasErrorNodeCached('test-element')).toBe(true);

            // Full refresh
            provider.refresh();

            expect(provider.getErrorNodeCacheSize()).toBe(0);
        });
    });
});