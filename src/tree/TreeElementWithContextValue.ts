/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Used both as a type in `implements TreeElementWithContextValue` (only the instance
// shape `contextValue` is required) and as a host for the static `createContextValue`
// helper. It is abstract so it can never be instantiated.
export abstract class TreeElementWithContextValue {
    abstract readonly contextValue: string;

    /**
     * Builds a deterministic context value string from the given parts:
     * de-duplicates, sorts, and joins them with `;`.
     *
     * Replaces the former `createContextValue` helper from
     * `@microsoft/vscode-azext-utils` so the logic stays local and vscode-free
     * (the library barrel couples to vscode and pulls in Web Crypto).
     */
    static createContextValue(values: string[]): string {
        return Array.from(new Set(values)).sort().join(';');
    }
}

export function isTreeElementWithContextValue(node: unknown): node is TreeElementWithContextValue {
    return typeof node === 'object' && node !== null && 'contextValue' in node;
}
