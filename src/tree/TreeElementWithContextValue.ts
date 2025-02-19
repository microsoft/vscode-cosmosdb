/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type TreeElementWithContextValue = {
    readonly contextValue: string;
};

export function isTreeElementWithContextValue(node: unknown): node is TreeElementWithContextValue {
    return typeof node === 'object' && node !== null && 'contextValue' in node;
}
