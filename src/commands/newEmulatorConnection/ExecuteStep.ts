/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { API } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { type StorageItem, StorageNames, StorageService } from '../../services/storageService';
import { WorkspaceResourceType } from '../../tree/workspace-api/SharedWorkspaceResourceProvider';
import { type EmulatorConfiguration } from '../../utils/emulatorConfiguration';
import {
    NewEmulatorConnectionMode,
    type NewEmulatorConnectionWizardContext,
} from './NewEmulatorConnectionWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<NewEmulatorConnectionWizardContext> {
    public priority: number = 100;

    public async execute(context: NewEmulatorConnectionWizardContext): Promise<void> {
        const parentId = context.parentTreeElementId;
        const connectionString = context.connectionString;
        const port = context.port;
        const experience = context.experience;

        switch (context.mode) {
            case NewEmulatorConnectionMode.Preconfigured:
                if (connectionString === undefined || port === undefined || experience === undefined) {
                    throw new Error(l10n.t('Internal error: connectionString, port, and api must be defined.'));
                }
                break;
            case NewEmulatorConnectionMode.CustomConnectionString:
                if (connectionString === undefined || experience === undefined) {
                    throw new Error(l10n.t('Internal error: connectionString must be defined.'));
                }
                break;
            default:
                throw new Error(l10n.t('Internal error: mode must be defined.'));
        }

        const portSuffix = typeof port !== 'undefined' ? ` : ${port}` : '';
        let label = `${experience.shortName} Emulator${portSuffix}`;

        if (experience.api === API.MongoDB || experience.api === API.MongoClusters) {
            label = `MongoDB Emulator${portSuffix}`;
        }

        return ext.state.showCreatingChild(
            parentId,
            l10n.t('Creating "{nodeName}"…', { nodeName: label }),
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));

                let isEmulator: boolean = true;
                let disableEmulatorSecurity: boolean | undefined;

                switch (experience.api) {
                    case API.MongoDB:
                    case API.MongoClusters: {
                        const mongoConfig = context.mongoEmulatorConfiguration as EmulatorConfiguration;
                        isEmulator = mongoConfig?.isEmulator ?? true;
                        disableEmulatorSecurity = mongoConfig?.disableEmulatorSecurity;
                        break;
                    }
                    // Add additional cases here for APIs that require different handling
                    default: {
                        isEmulator = context.isCoreEmulator ?? true;
                        break;
                    }
                }

                const storageItem: StorageItem = {
                    id: connectionString,
                    name: label,
                    properties: {
                        api: experience.api,
                        isEmulator,
                        ...(disableEmulatorSecurity && { disableEmulatorSecurity }),
                    },
                    secrets: [connectionString],
                };

                if (experience.api === API.MongoDB) {
                    await StorageService.get(StorageNames.Workspace).push(
                        WorkspaceResourceType.MongoClusters,
                        storageItem,
                        true,
                    );
                } else {
                    await StorageService.get(StorageNames.Workspace).push(
                        WorkspaceResourceType.AttachedAccounts,
                        storageItem,
                        true,
                    );
                }
            },
        );
    }

    public shouldExecute(context: NewEmulatorConnectionWizardContext): boolean {
        return !!context.connectionString;
    }
}
