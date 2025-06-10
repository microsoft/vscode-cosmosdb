/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * entry-point for mongoClusters-related code. Activated from ./src/extension.ts
 *
 * We'll try to have everything related to mongoClusters-support managed from here.
 * In case of a failure with this plan, this comment section will be updated.
 */
import { callWithTelemetryAndErrorHandling, type IActionContext, registerCommand } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
//import { MigrationPanelViewController } from '../webviews/mongoMigration/migrationPanelView/migrationPanelViewController';
import { MigrationPanelViewController } from '../webviews/mongoMigration/MigrationPanelViewController';
import { MongoAssessmentServiceRunner } from './assessmentService/assessmentServiceRunner';
import { DotnetRuntimeExtensionResolver } from './dotnetRuntime/dotnetRuntimeExtensionResolver';
import { isMongoMigrationSupportEnabled } from './utils/isMongoMigrationSupportEnabled';

export class MongoMigrationExtension implements vscode.Disposable {
    dispose(): Promise<void> {
        return Promise.resolve();
    }

    async activate(): Promise<void> {
        await callWithTelemetryAndErrorHandling(
            'cosmosDB.mongoMigration.activate',
            async (activateContext: IActionContext) => {
                activateContext.telemetry.properties.isActivationEvent = 'true';

                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const isMongoMigrationEnabled: boolean = isMongoMigrationSupportEnabled() ?? false;

                // allows to show/hide commands in the package.json file
                vscode.commands.executeCommand(
                    'setContext',
                    'vscodeDatabases.mongoMigrationSupportEnabled',
                    isMongoMigrationEnabled,
                );

                if (!isMongoMigrationEnabled) {
                    return;
                }

                // TODO: this takes a lot of time: how to defer it until the user actually tries to use the extension? how to handle exceptions?
                const dotNetInfo = await new DotnetRuntimeExtensionResolver(ext.outputChannel).getDotNetHostInfo();

                ext.outputChannel.appendLine(`Dotnet runtime path: ${dotNetInfo.path}`);

                await this.launchService();

                // using registerCommand instead of vscode.commands.registerCommand for better telemetry:
                // https://github.com/microsoft/vscode-azuretools/tree/main/utils#telemetry-and-error-handling

                registerCommand('command.migration.startView', () => {
                    const view = new MigrationPanelViewController({
                        moreSettings: false,
                    });

                    view.revealToForeground();
                });

                ext.outputChannel.appendLine(`MongoDB Migration Support: activated.`);
            },
        );
    }

    /**
     * Launches the JSON-RPC backend for this extension.
     *
     * @param dotnetPath Path to the 'dotnet' executable.
     * @param backendPath Path to the app that acts as a backend service for the extension.
     * @param context The VSCode extension context.
     */
    async launchService(): Promise<void> {
        await MongoAssessmentServiceRunner.createShell();
        //  await vscode.commands.executeCommand('dotnet.runproject', backendPath);
        console.log('MongoDB Migration backend service started.');
    }
}
