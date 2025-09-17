/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { API, CoreExperience, MongoExperience, tryGetExperience } from '../../../AzureDBExperiences';
import { databaseAccountType } from '../../../constants';
import { nonNullProp } from '../../../utils/nonNull';
import { BaseCachedBranchDataProvider } from '../../BaseCachedBranchDataProvider';
import { CosmosDBAccountUnsupportedResourceItem } from '../../cosmosdb/CosmosDBAccountUnsupportedResourceItem';
import { type CosmosDBAccountModel } from '../../cosmosdb/models/CosmosDBAccountModel';
import { type ClusterModel } from '../../documentdb/ClusterModel';
import { makeFilterable } from '../../mixins/Filterable';
import { makeSortable } from '../../mixins/Sortable';
import { NoSqlAccountResourceItem } from '../../nosql/NoSqlAccountResourceItem';
import { type TreeElement } from '../../TreeElement';
import { MongoRUResourceItem } from '../documentdb/mongo-ru/MongoRUResourceItem';

export class CosmosDBBranchDataProvider extends BaseCachedBranchDataProvider<CosmosDBAccountModel> {
    protected get contextValue(): string {
        return 'cosmosDB.azure';
    }

    protected createResourceItem(context: IActionContext, resource: CosmosDBAccountModel): TreeElement {
        const id = nonNullProp(resource, 'id');
        const name = nonNullProp(resource, 'name');
        const type = nonNullProp(resource, 'type');

        context.valuesToMask.push(id);
        context.valuesToMask.push(name);

        if (type.toLocaleLowerCase() === databaseAccountType.toLocaleLowerCase()) {
            const accountModel = resource;
            const experience = tryGetExperience(resource);

            let resourceItem: TreeElement | null = null;

            if (experience?.api === API.MongoDB) {
                const clusterInfo: ClusterModel = {
                    ...resource,
                    dbExperience: MongoExperience,
                } as ClusterModel;

                resourceItem = new MongoRUResourceItem(resource.subscription, clusterInfo);
            }

            if (experience?.api === API.Cassandra) {
                resourceItem = new NoSqlAccountResourceItem(accountModel, experience);
            }

            if (experience?.api === API.Core) {
                resourceItem = makeFilterable(makeSortable(new NoSqlAccountResourceItem(accountModel, experience)));
            }

            if (experience?.api === API.Graph) {
                context.telemetry.properties.isGraph = 'true';
                context.telemetry.properties.deprecated = 'true';

                // Uncomment this line if Graph support is ever re-added
                // resourceItem = new GraphAccountResourceItem(accountModel, experience);

                resourceItem = new CosmosDBAccountUnsupportedResourceItem(accountModel, experience);
            }

            if (experience?.api === API.Table) {
                context.telemetry.properties.isTable = 'true';
                context.telemetry.properties.deprecated = 'true';

                // Uncomment this line if Table support is ever re-added
                // resourceItem = new TableAccountResourceItem(accountModel, experience);

                resourceItem = new CosmosDBAccountUnsupportedResourceItem(accountModel, experience);
            }

            if (!resourceItem) {
                resourceItem = new NoSqlAccountResourceItem(accountModel, CoreExperience);
            }

            if (resourceItem) {
                return resourceItem;
            }
        }

        throw new Error(l10n.t('Unsupported resource type'));
    }

    protected onResourceItemRetrieved() {
        // No additional actions needed after retrieving the resource item
    }
}
