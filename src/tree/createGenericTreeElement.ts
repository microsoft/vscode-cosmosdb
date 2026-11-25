/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createGenericElement, type GenericElementOptions } from '@microsoft/vscode-azext-utils';
import { type TreeElement } from './TreeElement';

export function createGenericTreeElement(
    options: Omit<GenericElementOptions, 'id' | 'contextValue'> & { id: string },
): TreeElement {
    // Action and status rows must not inherit resource tags that enable context menus.
    return createGenericElement({ ...options, contextValue: 'treeItem.generic' }) as TreeElement;
}
