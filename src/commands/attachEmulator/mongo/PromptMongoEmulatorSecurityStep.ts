/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, openUrl, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { QuickPickItemKind } from 'vscode';
import { type AttachEmulatorWizardContext } from '../AttachEmulatorWizardContext';

export class PromptMongoEmulatorSecurityStep extends AzureWizardPromptStep<AttachEmulatorWizardContext> {
    public async prompt(context: AttachEmulatorWizardContext): Promise<void> {
        const selectedItem = await context.ui.showQuickPick(
            [
                {
                    id: 'enableTLS',
                    label: 'Enable TLS/SSL (Default)',
                    detail: 'Enforce TLS/SSL checks for a secure connection to the MongoDB Emulator.',
                    alwaysShow: true,
                    group: 'TLS/SSL',
                },
                {
                    id: 'disableTLS',
                    label: 'Disable TLS/SSL (Not recommended)',
                    detail: 'Disable TLS/SSL checks when connecting to the MongoDB Emulator.',
                    alwaysShow: true,
                    group: 'TLS/SSL',
                },
                {
                    label: '',
                    kind: QuickPickItemKind.Separator,
                },
                {
                    id: 'learnMore',
                    label: 'Learn more',
                    detail: 'Learn more about enabling TLS/SSL for the MongoDB Emulator.',
                    alwaysShow: true,
                    group: 'Learn More',
                },
            ],
            {
                enableGrouping: true,
                placeHolder: 'Configure TLS/SSL Security',
                stepName: 'securityConfiguration',
                suppressPersistence: true, // == the order of items will not be altered
            },
        );

        if (selectedItem.id === 'disableTLS') {
            context.disableMongoEmulatorSecurity = true;
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
