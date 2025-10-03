/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, openUrl, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { defaultMongoEmulatorConfiguration, type EmulatorConfiguration } from '../../../utils/emulatorConfiguration';
import { type NewEmulatorConnectionWizardContext } from '../NewEmulatorConnectionWizardContext';

export class PromptMongoRUEmulatorSecurityStep extends AzureWizardPromptStep<NewEmulatorConnectionWizardContext> {
    public async prompt(context: NewEmulatorConnectionWizardContext): Promise<void> {
        const selectedItem = await context.ui.showQuickPick(
            [
                {
                    id: 'enableTLS',
                    label: l10n.t('Enable TLS/SSL (Default)'),
                    detail: l10n.t('Enforce TLS/SSL checks for a secure connection to the MongoDB Emulator.'),
                    alwaysShow: true,
                    group: 'TLS/SSL',
                },
                {
                    id: 'disableTLS',
                    label: l10n.t('Disable TLS/SSL (Not recommended)'),
                    detail: l10n.t('Disable TLS/SSL checks when connecting to the MongoDB Emulator.'),
                    alwaysShow: true,
                    group: 'TLS/SSL',
                },
                {
                    label: '',
                    kind: vscode.QuickPickItemKind.Separator,
                },
                {
                    id: 'learnMore',
                    label: l10n.t('Learn more…'),
                    detail: l10n.t('Learn more about enabling TLS/SSL for the MongoDB Emulator.'),
                    alwaysShow: true,
                    group: 'Learn More',
                },
            ],
            {
                enableGrouping: true,
                placeHolder: l10n.t('Configure TLS/SSL Security'),
                stepName: 'securityConfiguration',
                suppressPersistence: true, // == the order of items will not be altered
            },
        );

        if (selectedItem.id === 'disableTLS') {
            if (!context.mongoEmulatorConfiguration) {
                context.mongoEmulatorConfiguration = defaultMongoEmulatorConfiguration;
            }

            const config = context.mongoEmulatorConfiguration as EmulatorConfiguration;
            config.disableEmulatorSecurity = true;
            return;
        }

        if (selectedItem.id === 'learnMore') {
            context.telemetry.properties.emulatorLearnMoreSecurity = 'true';

            await openUrl(
                'https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-develop-emulator?pivots=api-mongodb&tabs=windows%2Ccsharp#import-the-emulators-tlsssl-certificate',
            );
            throw new UserCancelledError();
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
