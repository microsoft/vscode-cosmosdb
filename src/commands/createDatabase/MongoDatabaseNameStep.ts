/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { MongoClustersClient } from '../../mongoClusters/MongoClustersClient';
import { type CreateMongoDatabaseWizardContext } from './CreateMongoDatabaseWizardContext';

export class MongoDatabaseNameStep extends AzureWizardPromptStep<CreateMongoDatabaseWizardContext> {
    public hideStepCount: boolean = true;

    public async prompt(context: CreateMongoDatabaseWizardContext): Promise<void> {
        const prompt: string = vscode.l10n.t('Enter a database name.');
        context.databaseName = (
            await context.ui.showInputBox({
                prompt,
                validateInput: (name?: string) => this.validateInput(name),
                asyncValidationTask: (name: string) => this.validateNameAvailable(context, name),
            })
        ).trim();

        context.valuesToMask.push(context.databaseName);
    }

    public shouldPrompt(context: CreateMongoDatabaseWizardContext): boolean {
        return !context.databaseName;
    }

    public validateInput(databaseName: string | undefined): string | undefined {
        // https://www.mongodb.com/docs/manual/reference/limits/#naming-restrictions

        databaseName = databaseName ? databaseName.trim() : '';

        if (databaseName.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        const forbiddenCharsLinux = /[\\/."$ ]/;
        const forbiddenCharsWindows = /[\\/."$*<>:|?]/;

        if (forbiddenCharsLinux.test(databaseName) || forbiddenCharsWindows.test(databaseName)) {
            return vscode.l10n.t(
                'Database name cannot contain any of the following characters: "{0}{1}"',
                forbiddenCharsLinux.source,
                forbiddenCharsWindows.source,
            );
        }

        if (databaseName.length > 64) {
            return vscode.l10n.t('Database name cannot be longer than {0} characters.', 64);
        }

        return undefined;
    }

    private async validateNameAvailable(
        context: CreateMongoDatabaseWizardContext,
        name: string,
    ): Promise<string | undefined> {
        if (name.length === 0) {
            return vscode.l10n.t('Database name is required.');
        }

        try {
            const client = await MongoClustersClient.getClient(context.credentialsId);
            const databases = await client.listDatabases();

            if (
                databases.filter((c) => 0 === c.name.localeCompare(name, undefined, { sensitivity: 'accent' })).length >
                0
            ) {
                return vscode.l10n.t(
                    'The database "{0}" already exists in the MongoDB Cluster "{1}".\nDo not rely on case to distinguish between databases. For example, you cannot use two databases with names like, salesData and SalesData.',
                    name,
                    context.clusterName,
                );
            }
        } catch (_error) {
            console.error(_error); // todo: push it to our telemetry
            return undefined; // we don't want to block the user from continuing if we can't validate the name
        }

        return undefined;
    }
}
