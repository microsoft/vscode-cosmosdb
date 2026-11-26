/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { API, type Experience } from '../../AzureDBExperiences';
import { maskConnectionTelemetry } from '../../cosmosdb/maskConnectionTelemetry';
import { ext } from '../../extensionVariables';
import { getAccountInfo, type AccountInfo } from '../../tree/cosmosdb/AccountInfo';
import { type CosmosDBAccountAttachedResourceItem } from '../../tree/cosmosdb/CosmosDBAccountAttachedResourceItem';
import { type CosmosDBAccountResourceItem } from '../../tree/cosmosdb/CosmosDBAccountResourceItem';
import { isFabricTreeElement, type FabricTreeElement } from '../../tree/fabric-resources-view/FabricTreeElement';
import { isTreeElement, type TreeElement } from '../../tree/TreeElement';
import { isTreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';
import { isTreeElementWithExperience } from '../../tree/TreeElementWithExperience';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { nonNullValue } from '../../utils/nonNull';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { isDataModelerFeatureEnabled } from '../dataModeling/dataModelerFeatureFlag';
import { openDataModelingWizard } from '../dataModeling/openDataModelingWizard';
import { CosmosDBDatabaseNameStep } from './CosmosDBDatabaseNameStep';
import { CosmosDBExecuteStep } from './CosmosDBExecuteStep';
import { type CreateDatabaseWizardContext } from './CreateDatabaseWizardContext';
import { promptDatabaseNameOrDataModeler } from './promptDatabaseNameOrDataModeler';

export async function cosmosDBCreateDatabase(
    context: IActionContext,
    node?: TreeElement | FabricTreeElement,
): Promise<void> {
    const element: TreeElement | undefined = isFabricTreeElement(node)
        ? node.element
        : isTreeElement(node)
          ? node
          : // pickAppResource works only with Azure Resources tree
            await pickAppResource<CosmosDBAccountResourceItem | CosmosDBAccountAttachedResourceItem>(context, {
                type: AzExtResourceType.AzureCosmosDb,
                expectedChildContextValue: 'treeItem.account',
            });

    if (!element) {
        return undefined;
    }

    if (!isTreeElementWithExperience(element)) {
        throw new Error(l10n.t('The selected item does not have experience information.'));
    }

    if (!isTreeElementWithContextValue(element) || !element.contextValue.includes('treeItem.account')) {
        throw new Error(l10n.t('The selected item is not a Cosmos DB account.'));
    }

    const accountNode = element as CosmosDBAccountResourceItem | CosmosDBAccountAttachedResourceItem;

    await createDatabase(context, await getAccountInfo(accountNode.account), accountNode.experience);
}

export async function createDatabase(
    context: IActionContext,
    accountInfo: AccountInfo,
    experience: Experience,
): Promise<void> {
    context.valuesToMask.push(accountInfo.id, accountInfo.name);
    maskConnectionTelemetry(context, accountInfo);

    context.telemetry.properties.experience = experience.api;

    const wizardContext: CreateDatabaseWizardContext = {
        ...context,
        accountInfo,
    };

    if (experience.api === API.Core && ext.isAIFeaturesEnabled && isDataModelerFeatureEnabled()) {
        const choice = await promptDatabaseNameOrDataModeler(accountInfo);
        context.telemetry.properties.creationChoice = choice.kind;
        if (choice.kind === 'dataModeler') {
            await openDataModelingWizard(context, accountInfo);
            return;
        }
        context.valuesToMask.push(choice.databaseName);
        wizardContext.databaseName = choice.databaseName;
    }

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Create database'),
        promptSteps: [new CosmosDBDatabaseNameStep()],
        executeSteps: [new CosmosDBExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    const newDatabaseName = nonNullValue(wizardContext.databaseName);
    showConfirmationAsInSettings(l10n.t('The "{name}" database has been created.', { name: newDatabaseName }));
}
