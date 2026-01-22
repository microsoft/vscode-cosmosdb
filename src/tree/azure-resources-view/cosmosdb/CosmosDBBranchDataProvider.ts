/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import {
    API,
    CoreExperience,
    PostgresFlexibleExperience,
    PostgresSingleExperience,
    tryGetExperience,
} from '../../../AzureDBExperiences';
import { nonNullProp } from '../../../utils/nonNull';
import { BaseCachedBranchDataProvider } from '../../BaseCachedBranchDataProvider';
import { CosmosDBAccountUnsupportedResourceItem } from '../../cosmosdb/CosmosDBAccountUnsupportedResourceItem';
import { type CosmosDBAccountModel } from '../../cosmosdb/models/CosmosDBAccountModel';
import { makeFilterable } from '../../mixins/Filterable';
import { makeSortable } from '../../mixins/Sortable';
import { NoSqlAccountResourceItem } from '../../nosql/NoSqlAccountResourceItem';
import { type TreeElement } from '../../TreeElement';

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

        if (type.toLocaleLowerCase() === 'microsoft.documentdb/databaseaccounts') {
            const accountModel = resource;
            const experience = tryGetExperience(resource);

            if (experience?.api === API.Core) {
                return makeFilterable(makeSortable(new NoSqlAccountResourceItem(accountModel, experience)));
            }

            if (experience?.api === API.Cassandra) {
                context.telemetry.properties.isCassandra = 'true';
                context.telemetry.properties.deprecated = 'true';

                return new CosmosDBAccountUnsupportedResourceItem(accountModel, experience);
            }

            if (experience?.api === API.Graph) {
                context.telemetry.properties.isGraph = 'true';
                context.telemetry.properties.deprecated = 'true';

                return new CosmosDBAccountUnsupportedResourceItem(accountModel, experience);
            }

            if (experience?.api === API.Table) {
                context.telemetry.properties.isTable = 'true';
                context.telemetry.properties.deprecated = 'true';

                return new CosmosDBAccountUnsupportedResourceItem(accountModel, experience);
            }

            return new CosmosDBAccountUnsupportedResourceItem(accountModel, CoreExperience);
        }

        if (type.toLocaleLowerCase() === 'microsoft.dbforpostgresql/flexibleservers') {
            context.telemetry.properties.isPostgres = 'true';
            context.telemetry.properties.deprecated = 'true';

            return new CosmosDBAccountUnsupportedResourceItem(
                resource,
                PostgresFlexibleExperience,
                l10n.t('PostgreSQL Flexible Servers are no longer supported in Cosmos DB extension.') +
                    ' ' +
                    l10n.t('Please use the dedicated PostgreSQL extension instead.'),
            );
        }

        if (type.toLocaleLowerCase() === 'microsoft.dbforpostgresql/servers') {
            context.telemetry.properties.isPostgres = 'true';
            context.telemetry.properties.deprecated = 'true';

            return new CosmosDBAccountUnsupportedResourceItem(
                resource,
                PostgresSingleExperience,
                l10n.t('PostgreSQL Single Servers are no longer supported in Cosmos DB extension.') +
                    ' ' +
                    l10n.t('Please use the dedicated PostgreSQL extension instead.'),
            );
        }

        throw new Error(l10n.t('Unsupported resource type'));
    }

    protected onResourceItemRetrieved() {
        // No additional actions needed after retrieving the resource item
    }
}
