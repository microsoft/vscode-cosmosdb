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
import { type TreeElement } from '../TreeElement';
import { CosmosDBAccountAttachedResourceItem } from '../cosmosdb/CosmosDBAccountAttachedResourceItem';
import { type CosmosDBAttachedAccountModel } from '../workspace-view/cosmosdb/CosmosDBAttachedAccountModel';

export class TableAccountAttachedResourceItem extends CosmosDBAccountAttachedResourceItem {
    constructor(account: CosmosDBAttachedAccountModel, experience: Experience) {
        super(account, experience);
    }

    public async getChildren(): Promise<TreeElement[]> {
        const result = await callWithTelemetryAndErrorHandling('getChildren', (context: IActionContext) => {
            context.telemetry.properties.experience = this.experience.api;
            context.telemetry.properties.parentContext = this.contextValue;

            return Promise.resolve([
                createGenericElement({
                    contextValue: `${this.contextValue}/notSupported`,
                    label: l10n.t('Table Accounts are not supported yet.'),
                    id: `${this.id}/notSupported`,
                }) as TreeElement,
            ]);
        });

        return result ?? [];
    }

    protected getChildrenImpl(): Promise<TreeElement[]> {
        throw new Error(l10n.t('Method not implemented.'));
    }
}
