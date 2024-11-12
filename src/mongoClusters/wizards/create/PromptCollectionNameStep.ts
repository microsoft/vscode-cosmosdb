/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { localize } from '../../../utils/localize';
import { MongoClustersClient } from '../../MongoClustersClient';
import { type CreateCollectionWizardContext } from './createWizardContexts';

export class CollectionNameStep extends AzureWizardPromptStep<CreateCollectionWizardContext> {
    public hideStepCount: boolean = true;

    public async prompt(context: CreateCollectionWizardContext): Promise<void> {
        const prompt: string = localize('mongoClusters.collectionNamePrompt', 'Enter a collection name.');
        context.newCollectionName = (
            await context.ui.showInputBox({
                prompt,
                validateInput: CollectionNameStep.validateInput,
                asyncValidationTask: (name: string) => this.validateNameAvailable(context, name),
            })
        ).trim();

        context.valuesToMask.push(context.newCollectionName);
    }

    public shouldPrompt(context: CreateCollectionWizardContext): boolean {
        return !context.newCollectionName;
    }

    public static validateInput(this: void, collectionName: string | undefined): string | undefined {
        // https://www.mongodb.com/docs/manual/reference/limits/#mongodb-limit-Restriction-on-Collection-Names

        collectionName = collectionName ? collectionName.trim() : '';

        if (collectionName.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        if (!/^[a-zA-Z_]/.test(collectionName)) {
            return localize(
                'mongoClusters.collectionNameDoesntStartWithLetter',
                'Collection names should begin with an underscore or a letter character.',
            );
        }

        if (/[$]/.test(collectionName)) {
            return localize('mongoClusters.collectionNameContainsDollar', 'Collection name cannot contain the $.');
        }

        if (collectionName.includes('\0')) {
            return localize(
                'mongoClusters.collectionNameContainsNull',
                'Collection name cannot contain the null character.',
            );
        }

        if (collectionName.startsWith('system.')) {
            return localize(
                'mongoClusters.collectionNameStartsWithSystem',
                'Collection name cannot begin with the system. prefix (Reserved for internal use).',
            );
        }

        if (collectionName.includes('.system.')) {
            return localize('mongoClusters.collectionNameContainsSystem', 'Collection name cannot contain .system.');
        }

        return undefined;
    }

    private async validateNameAvailable(
        context: CreateCollectionWizardContext,
        name: string,
    ): Promise<string | undefined> {
        if (name.length === 0) {
            return localize('mongoClusters.collectionNameRequired', 'Collection name is required.');
        }

        try {
            const client = await MongoClustersClient.getClient(context.credentialsId);
            const collections = await client.listCollections(context.databaseItem.databaseInfo.name);

            if (collections.filter((c) => c.name === name).length > 0) {
                return localize(
                    'mongoClusters.collectionExists',
                    'The collection "{0}" already exists in the database "{1}".',
                    name,
                    context.databaseItem.databaseInfo.name,
                );
            }
        } catch (_error) {
            console.log(_error); // todo: push it to our telemetry
            return undefined; // we don't want to block the user from continuing if we can't validate the name
        }

        return undefined;
    }
}
