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
import { type CosmosDBAccountModel } from '../../cosmosdb/models/CosmosDBAccountModel';
import { type ClusterModel } from '../../documentdb/ClusterModel';
import { GraphAccountResourceItem } from '../../graph/GraphAccountResourceItem';
import { NoSqlAccountResourceItem } from '../../nosql/NoSqlAccountResourceItem';
import { TableAccountResourceItem } from '../../table/TableAccountResourceItem';
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
                resourceItem = new NoSqlAccountResourceItem(accountModel, experience);
            }

            if (experience?.api === API.Graph) {
                resourceItem = new GraphAccountResourceItem(accountModel, experience);
            }

            if (experience?.api === API.Table) {
                resourceItem = new TableAccountResourceItem(accountModel, experience);
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
}
