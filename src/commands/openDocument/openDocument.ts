/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { API } from '../../AzureDBExperiences';
import { ItemFileDescriptor } from '../../cosmosdb/fs/ItemFileDescriptor';
import { ext } from '../../extensionVariables';
import { type CosmosDBItemResourceItem } from '../../tree/cosmosdb/CosmosDBItemResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { countExperienceUsageForSurvey } from '../../utils/survey';
import { ExperienceKind, UsageImpact } from '../../utils/surveyTypes';
import { DocumentsViewController } from '../../webviews/documentdb/documentView/documentsViewController';

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

    const fsNode = new ItemFileDescriptor(node.id, node.model, node.experience);
    // Clear un-uploaded local changes to the document before opening https://github.com/microsoft/vscode-cosmosdb/issues/1619
    ext.fileSystem.fireChangedEvent(fsNode);
    await ext.fileSystem.showTextDocument(fsNode);

    const experienceKind = [API.MongoDB, API.MongoClusters].includes(node.experience.api)
        ? ExperienceKind.Mongo
        : ExperienceKind.NoSQL;
    countExperienceUsageForSurvey(experienceKind, UsageImpact.Low);
}

export function openMongoDocumentView(
    _context: IActionContext,
    props: {
        id: string;

        clusterId: string;
        databaseName: string;
        collectionName: string;
        documentId: string;

        mode: string;
    },
): void {
    const view = new DocumentsViewController({
        id: props.id,

        clusterId: props.clusterId,
        databaseName: props.databaseName,
        collectionName: props.collectionName,
        documentId: props.documentId,

        mode: props.mode,
    });

    view.revealToForeground(vscode.ViewColumn.Active);
}
