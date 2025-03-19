/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    createGenericElement,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type Experience } from '../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { DocumentDBAccountResourceItem } from '../docdb/DocumentDBAccountResourceItem';
import { type DocumentDBAccountModel } from '../docdb/models/DocumentDBAccountModel';

export class TableAccountResourceItem extends DocumentDBAccountResourceItem {
    constructor(account: DocumentDBAccountModel, experience: Experience) {
        super(account, experience);
    }

    public async getChildren(): Promise<CosmosDBTreeElement[]> {
        const result = await callWithTelemetryAndErrorHandling('getChildren', (context: IActionContext) => {
            context.telemetry.properties.experience = this.experience.api;
            context.telemetry.properties.parentContext = this.contextValue;

            return Promise.resolve([
                createGenericElement({
                    contextValue: `${this.contextValue}/notSupported`,
                    label: l10n.t('Table Accounts are not supported yet.'),
                    id: `${this.id}/notSupported`,
                }) as CosmosDBTreeElement,
            ]);
        });

        return result ?? [];
    }

    protected getChildrenImpl(): Promise<CosmosDBTreeElement[]> {
        throw new Error(l10n.t('Method not implemented.'));
    }
}
