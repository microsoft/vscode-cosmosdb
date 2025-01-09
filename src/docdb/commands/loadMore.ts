/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';

export async function loadMore(
    context: IActionContext,
    nodeId: string,
    loadMoreFn: (context: IActionContext) => Promise<void> | undefined,
): Promise<void> {
    if (loadMoreFn) {
        await loadMoreFn(context);
        ext.state.notifyChildrenChanged(nodeId);
    }
}
