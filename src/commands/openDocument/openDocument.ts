/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { createNoSqlQueryConnection } from '../../cosmosdb/NoSqlQueryConnection';
import { DocumentTab } from '../../panels/DocumentTab';
import { type CosmosDBItemResourceItem } from '../../tree/cosmosdb/CosmosDBItemResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { countExperienceUsageForSurvey } from '../../utils/survey';
import { ExperienceKind, UsageImpact } from '../../utils/surveyTypes';

export async function cosmosDBOpenItem(context: IActionContext, node?: CosmosDBItemResourceItem): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBItemResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.document'],
        });
    }

    if (!node) {
        return;
    }

    context.telemetry.properties.experience = node.experience.api;

    DocumentTab.render(
        createNoSqlQueryConnection(node),
        'edit',
        node.documentId ?? node.model.item,
        vscode.ViewColumn.Active,
    );

    const experienceKind = ExperienceKind.NoSQL;
    countExperienceUsageForSurvey(experienceKind, UsageImpact.Low);
}
