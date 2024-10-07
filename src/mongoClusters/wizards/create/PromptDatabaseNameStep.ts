import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { localize } from '../../../utils/localize';
import { MongoClustersClient } from '../../MongoClustersClient';
import { type CreateDatabaseWizardContext } from './createWizardContexts';

export class DatabaseNameStep extends AzureWizardPromptStep<CreateDatabaseWizardContext> {
    public hideStepCount: boolean = true;

    public async prompt(context: CreateDatabaseWizardContext): Promise<void> {
        const prompt: string = localize('mongoClusters.databaseNamePrompt', 'Enter a database name.');
        context.newDatabaseName = (
            await context.ui.showInputBox({
                prompt,
                validateInput: DatabaseNameStep.validateInput,
                asyncValidationTask: (name: string) => this.validateNameAvailable(context, name),
            })
        ).trim();

        context.valuesToMask.push(context.newDatabaseName);
    }

    public shouldPrompt(context: CreateDatabaseWizardContext): boolean {
        return !context.newDatabaseName;
    }

    public static validateInput(this: void, databaseName: string | undefined): string | undefined {
        // https://www.mongodb.com/docs/manual/reference/limits/#naming-restrictions

        databaseName = databaseName ? databaseName.trim() : '';

        if (databaseName.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        const forbiddenCharsLinux = /[\\/."$ ]/;
        const forbiddenCharsWindows = /[\\/."$*<>:|?]/;

        if (forbiddenCharsLinux.test(databaseName) || forbiddenCharsWindows.test(databaseName)) {
            return localize(
                'mongoClusters.databaseContainsForbiddenChars',
                'Database name cannot contain any of the following characters: "{0}{1}"',
                forbiddenCharsLinux.source,
                forbiddenCharsWindows.source,
            );
        }

        if (databaseName.length > 64) {
            return localize(
                'mongoClusters.databaseNameTooLong',
                'Database name cannot be longer than {0} characters.',
                64,
            );
        }

        return undefined;
    }

    private async validateNameAvailable(
        context: CreateDatabaseWizardContext,
        name: string,
    ): Promise<string | undefined> {
        if (name.length === 0) {
            return localize('mongoClusters.databaseNameRequired', 'Database name is required.');
        }

        try {
            const client = await MongoClustersClient.getClient(context.credentialsId);
            const databases = await client.listDatabases();

            if (
                databases.filter((c) => 0 === c.name.localeCompare(name, undefined, { sensitivity: 'accent' })).length >
                0
            ) {
                return localize(
                    'mongoClusters.databaseExists',
                    'The database "{0}" already exists in the MongoDB (vCore) cluster "{1}". \n' +
                        'Do not rely on case to distinguish between databases. For example, you cannot use two databases with names like, salesData and SalesData.',
                    name,
                    context.mongoClusterItem.mongoCluster.name,
                );
            }
        } catch (_error) {
            console.log(_error); // todo: push it to our telemetry
            return undefined; // we don't want to block the user from continuing if we can't validate the name
        }

        return undefined;
    }
}
