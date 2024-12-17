/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createGenericElement } from '@microsoft/vscode-azext-utils';
import { type CosmosDbTreeElement } from '../CosmosDbTreeElement';
import { DocumentDBAccountResourceItem } from '../DocumentDBAccountResourceItem';

export class TableAccountResourceItem extends DocumentDBAccountResourceItem {
    public getChildren(): Promise<CosmosDbTreeElement[]> {
        return Promise.resolve([
            createGenericElement({
                contextValue: 'tableNotSupported',
                label: 'Table Accounts are not supported yet.',
                id: `${this.id}/no-databases`,
            }) as CosmosDbTreeElement,
        ]);
    }
}
