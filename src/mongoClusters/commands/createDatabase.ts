import { AzureWizard, nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import { localize } from '../../utils/localize';
import { type MongoClusterItem } from '../tree/MongoClusterItem';
import {
    type CreateCollectionWizardContext,
    type CreateDatabaseWizardContext,
} from '../wizards/create/createWizardContexts';
import { DatabaseNameStep } from '../wizards/create/PromptDatabaseNameStep';

export async function createDatabase(context: IActionContext, clusterNode?: MongoClusterItem): Promise<void> {
    // node ??= ... pick a node if not provided
    if (!clusterNode) {
        throw new Error('No cluster selected.');
    }

    if (!clusterNode.mongoCluster.session) {
        throw new Error(
            localize(
                'mongoClusters.notSignedIn',
                'You are not signed in to the MongoDB (vCore) cluster. Please sign in (by expanding the node "{0}") and try again.',
                clusterNode.mongoCluster.name,
            ),
        );
    }

    const wizardContext: CreateDatabaseWizardContext = {
        ...context,
        credentialsId: clusterNode.mongoCluster.session?.credentialId ?? '',
        mongoClusterItem: clusterNode,
    };

    const wizard: AzureWizard<CreateCollectionWizardContext> = new AzureWizard(wizardContext, {
        title: localize('mongoClusters.createDatabase.title', 'Create database'),
        promptSteps: [new DatabaseNameStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();

    const newDatabaseName = nonNullValue(wizardContext.newDatabaseName);

    await clusterNode.createDatabase(context, newDatabaseName);
}
