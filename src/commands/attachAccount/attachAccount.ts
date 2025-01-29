/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzExtTreeItem,
    AzureWizard,
    type AzureWizardExecuteStep,
    type AzureWizardPromptStep,
    type IActionContext,
    type IAzureQuickPickItem,
} from '@microsoft/vscode-azext-utils';
import {
    API,
    getCosmosExperienceQuickPicks,
    getExperienceQuickPicks,
    getMongoCoreExperienceQuickPicks,
    getPostgresExperienceQuickPicks,
    type Experience,
} from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { MongoDBAttachAccountResourceItem } from '../../mongoClusters/tree/workspace/MongoDBAttachAccountResourceItem';
import { CosmosDBAttachAccountResourceItem } from '../../tree/attached/CosmosDBAttachAccountResourceItem';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { localize } from '../../utils/localize';
import { type AttachAccountWizardContext } from './AttachAccountWizardContext';
import { DocumentDBConnectionStringStep } from './DocumentDBConnectionStringStep';
import { DocumentDBExecuteStep } from './DocumentDBExecuteStep';
import { MongoConnectionStringStep } from './MongoConnectionStringStep';
import { MongoExecuteStep } from './MongoExecuteStep';
import { MongoPasswordStep } from './MongoPasswordStep';
import { MongoUsernameStep } from './MongoUsernameStep';
import { PostgresConnectionStringStep } from './PostgresConnectionStringStep';
import { PostgresExecuteStep } from './PostgresExecuteStep';
import { PostgresPasswordStep } from './PostgresPasswordStep';
import { PostgresUsernameStep } from './PostgresUsernameStep';

enum QuickPickType {
    ALL,
    Postgres,
    Cosmos,
    Mongo,
}

async function getExperience(context: IActionContext, type: QuickPickType) {
    const quickPicks: IAzureQuickPickItem<Experience>[] = [];
    switch (type) {
        case QuickPickType.Postgres:
            quickPicks.push(...getPostgresExperienceQuickPicks());
            break;
        case QuickPickType.Cosmos:
            quickPicks.push(...getCosmosExperienceQuickPicks());
            break;
        case QuickPickType.Mongo:
            quickPicks.push(...getMongoCoreExperienceQuickPicks());
            break;
        case QuickPickType.ALL:
        default:
            quickPicks.push(...getExperienceQuickPicks());
    }

    if (quickPicks.length === 0) {
        throw new Error('No experiences found');
    }

    if (quickPicks.length === 1) {
        return quickPicks[0].data;
    }

    const result: IAzureQuickPickItem<Experience> = await context.ui.showQuickPick(quickPicks, {
        placeHolder: localize('selectDBServerMsg', 'Select an Azure Database Server'),
    });

    return result.data;
}

export async function attachAccount(
    context: IActionContext,
    node?: AzExtTreeItem | CosmosDBAttachAccountResourceItem | MongoDBAttachAccountResourceItem,
): Promise<void> {
    let type: QuickPickType = QuickPickType.ALL;
    let parentId: string = '';

    if (node instanceof AzExtTreeItem) {
        type = QuickPickType.Postgres;
        parentId = node.parent?.id ?? '';
    }

    if (node instanceof CosmosDBAttachAccountResourceItem) {
        type = QuickPickType.Cosmos;
        parentId = node.parentId ?? ext.cosmosDBWorkspaceBranchDataResource.id;
    }

    if (node instanceof MongoDBAttachAccountResourceItem) {
        type = QuickPickType.Mongo;
        parentId = node.parentId ?? ext.mongoClusterWorkspaceBranchDataResource.id;
    }

    const experience = await getExperience(context, type);
    const steps: AzureWizardPromptStep<AttachAccountWizardContext>[] = [];
    const executeSteps: AzureWizardExecuteStep<AttachAccountWizardContext>[] = [];

    if (experience.api === API.PostgresFlexible || experience.api === API.PostgresSingle) {
        steps.push(new PostgresConnectionStringStep(), new PostgresUsernameStep(), new PostgresPasswordStep());
        executeSteps.push(new PostgresExecuteStep());
    }

    if (experience.api === API.MongoDB || experience.api === API.MongoClusters) {
        steps.push(new MongoConnectionStringStep(), new MongoUsernameStep(), new MongoPasswordStep());
        executeSteps.push(new MongoExecuteStep());
    }

    if (
        experience.api === API.Core ||
        experience.api === API.Table ||
        experience.api === API.Graph ||
        experience.api === API.Cassandra
    ) {
        steps.push(new DocumentDBConnectionStringStep());
        executeSteps.push(new DocumentDBExecuteStep());
    }

    const wizardContext: AttachAccountWizardContext = { ...context, experience, parentId };

    const wizard = new AzureWizard(wizardContext, {
        title: localize('attachAccountTitle', 'Attach Account'),
        promptSteps: steps,
        executeSteps: executeSteps,
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    showConfirmationAsInSettings(
        localize('showConfirmation.addedWorkspaceConnection', 'New connection has been added to your workspace.'),
    );
}
