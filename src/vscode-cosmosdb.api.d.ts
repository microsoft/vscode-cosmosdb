/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export interface VscodeCosmos {
    readonly getConnectionString: (treeItemId: string) => Promise<string>;
    readonly getDatabase: () => Promise<string>;
    readonly revealTreeItem: (treeItemId: string) => Promise<void>;
}
