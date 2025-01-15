/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    createGenericElement,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { type Experience } from '../../AzureDBExperiences';
import { type CosmosDBAttachedAccountModel } from '../attached/CosmosDBAttachedAccountModel';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { DocumentDBAccountAttachedResourceItem } from '../docdb/DocumentDBAccountAttachedResourceItem';

export class TableAccountAttachedResourceItem extends DocumentDBAccountAttachedResourceItem {
    constructor(account: CosmosDBAttachedAccountModel, experience: Experience) {
        super(account, experience);
    }

    public async getChildren(): Promise<CosmosDBTreeElement[]> {
        const result = await callWithTelemetryAndErrorHandling('getChildren', (context: IActionContext) => {
            context.telemetry.properties.experience = this.experience.api;
            context.telemetry.properties.parentContext = this.contextValue;

            return Promise.resolve([
                createGenericElement({
                    contextValue: `${this.contextValue}/notSupported`,
                    label: 'Table Accounts are not supported yet.',
                    id: `${this.id}/notSupported`,
                }) as CosmosDBTreeElement,
            ]);
        });

        return result ?? [];
    }

    protected getChildrenImpl(): Promise<CosmosDBTreeElement[]> {
        throw new Error('Method not implemented.');
    }
}
