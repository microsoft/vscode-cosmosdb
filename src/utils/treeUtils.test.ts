/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { hasRetryNode } from './treeUtils';
import { type TreeElement } from '../tree/TreeElement';

describe('Error Node Caching', () => {
    describe('hasRetryNode', () => {
        const createMockTreeElement = (id: string): TreeElement => ({
            id,
            getTreeItem: jest.fn().mockResolvedValue({}),
        } as unknown as TreeElement);

        test('should return true when children contain a retry node', () => {
            const children = [
                createMockTreeElement('node1'),
                createMockTreeElement('node2/reconnect'),
                createMockTreeElement('node3'),
            ];

            expect(hasRetryNode(children)).toBe(true);
        });

        test('should return false when children do not contain retry nodes', () => {
            const children = [
                createMockTreeElement('node1'),
                createMockTreeElement('node2'),
                createMockTreeElement('node3'),
            ];

            expect(hasRetryNode(children)).toBe(false);
        });

        test('should return false for empty array', () => {
            expect(hasRetryNode([])).toBe(false);
        });

        test('should return false for null', () => {
            expect(hasRetryNode(null)).toBe(false);
        });

        test('should return false for undefined', () => {
            expect(hasRetryNode(undefined)).toBe(false);
        });

        test('should handle multiple retry nodes', () => {
            const children = [
                createMockTreeElement('node1/reconnect'),
                createMockTreeElement('node2'),
                createMockTreeElement('node3/reconnect'),
            ];

            expect(hasRetryNode(children)).toBe(true);
        });

        test('should handle nodes with undefined ids', () => {
            const children = [
                { id: undefined, getTreeItem: jest.fn() } as unknown as TreeElement,
                createMockTreeElement('node2/reconnect'),
            ];

            expect(hasRetryNode(children)).toBe(true);
        });
    });
});