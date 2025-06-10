/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeElement } from './TreeElement';

/**
 * Represents a tree element with retry-mode support.
 *
 * A `TreeElement` implementation should implement this type/interface if it wishes to benefit
 * from retry/error node caching. When the `getChildren` method of a `TreeElement` is called, it can
 * return retry nodes. The caller will cache these nodes to avoid expensive children
 * retrieval on erroneous nodes unless a retry is explicitly requested by the user. A dedicated command
 * can be initiated in case a retry is needed.
 *
 * An example of usage can be seen in the `ClusterItemBase`, where retry nodes are returned
 * for clusters that fail to connect, and caching is used to optimize subsequent operations.
 */
export type TreeElementWithRetryChildren = {
    hasRetryNode(children: TreeElement[] | null | undefined): boolean;
};

export function isTreeElementWithRetryChildren(node: unknown): node is TreeElementWithRetryChildren {
    return typeof node === 'object' && node !== null && 'hasRetryNode' in node;
}
