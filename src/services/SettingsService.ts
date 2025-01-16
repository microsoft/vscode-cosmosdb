/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { ConfigurationTarget, Uri, workspace, type WorkspaceConfiguration, type WorkspaceFolder } from 'vscode';
import { ext } from '../extensionVariables';

export const vscodeFolder: string = '.vscode';
export const settingsFile: string = 'settings.json';

export class SettingUtils {
    /**
     * Directly updates one of the user's `Global` configuration settings.
     * @param key The key of the setting to update
     * @param value The value of the setting to update
     * @param prefix The optional extension prefix. Uses ext.prefix unless otherwise specified
     */
    async updateGlobalSetting<T = string>(key: string, value: T, prefix: string = ext.prefix): Promise<void> {
        const projectConfiguration: WorkspaceConfiguration = workspace.getConfiguration(prefix);
        await projectConfiguration.update(key, value, ConfigurationTarget.Global);
    }

    /**
     * Directly updates one of the user's `Workspace` or `WorkspaceFolder` settings.
     * @param key The key of the setting to update
     * @param value The value of the setting to update
     * @param fsPath The path of the workspace configuration settings
     * @param targetSetting The optional workspace setting to target. Uses the `Workspace` configuration target unless otherwise specified
     * @param prefix The optional extension prefix. Uses ext.prefix unless otherwise specified
     */
    async updateWorkspaceSetting<T = string>(
        key: string,
        value: T,
        fsPath: string,
        targetSetting:
            | ConfigurationTarget.Workspace
            | ConfigurationTarget.WorkspaceFolder = ConfigurationTarget.Workspace,
        prefix: string = ext.prefix,
    ): Promise<void> {
        const projectConfiguration: WorkspaceConfiguration = workspace.getConfiguration(prefix, Uri.file(fsPath));
        await projectConfiguration.update(key, value, targetSetting);
    }

    /**
     * Directly retrieves one of the user's `Global` configuration settings.
     * @param key The key of the setting to retrieve
     * @param prefix The optional extension prefix. Uses ext.prefix unless otherwise specified
     */
    getGlobalSetting<T>(key: string, prefix: string = ext.prefix): T | undefined {
        const projectConfiguration: WorkspaceConfiguration = workspace.getConfiguration(prefix);
        const result: { globalValue?: T; defaultValue?: T } | undefined = projectConfiguration.inspect<T>(key);
        return result?.globalValue === undefined ? result?.defaultValue : result?.globalValue;
    }

    /**
     * Iteratively retrieves one of the user's workspace settings - sequentially checking for a defined value starting from the `WorkspaceFolder` up to the provided target configuration limit.
     * @param key The key of the setting to retrieve
     * @param fsPath The optional path of the workspace configuration settings
     * @param targetLimit The optional target configuration limit (inclusive). Uses the `Workspace` configuration target unless otherwise specified
     * @param prefix The optional extension prefix. Uses ext.prefix unless otherwise specified
     */
    getWorkspaceSetting<T>(
        key: string,
        fsPath?: string,
        targetLimit:
            | ConfigurationTarget.Workspace
            | ConfigurationTarget.WorkspaceFolder = ConfigurationTarget.Workspace,
        prefix: string = ext.prefix,
    ): T | undefined {
        const projectConfiguration: WorkspaceConfiguration = workspace.getConfiguration(
            prefix,
            fsPath ? Uri.file(fsPath) : undefined,
        );

        const configurationLevel: ConfigurationTarget | undefined = this.getLowestConfigurationLevel(
            projectConfiguration,
            key,
        );
        if (!configurationLevel || (configurationLevel && configurationLevel < targetLimit)) {
            return undefined;
        }

        return projectConfiguration.get<T>(key);
    }

    /**
     * Iteratively retrieves one of the user's settings - sequentially checking for a defined value starting from the `WorkspaceFolder` up to the `Global` configuration target.
     * @param key The key of the setting to retrieve
     * @param fsPath The optional path of the workspace configuration settings
     * @param prefix The optional extension prefix. Uses ext.prefix unless otherwise specified
     */
    getSetting<T>(key: string, fsPath?: string, prefix: string = ext.prefix): T | undefined {
        const projectConfiguration: WorkspaceConfiguration = workspace.getConfiguration(
            prefix,
            fsPath ? Uri.file(fsPath) : undefined,
        );
        return projectConfiguration.get<T>(key);
    }

    /**
     * Searches through all open folders and gets the current workspace setting (as long as there are no conflicts)
     * Uses ext.prefix unless otherwise specified
     */
    getWorkspaceSettingFromAnyFolder(key: string, prefix: string = ext.prefix): string | undefined {
        if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
            let result: string | undefined;
            for (const folder of workspace.workspaceFolders) {
                const projectConfiguration: WorkspaceConfiguration = workspace.getConfiguration(prefix, folder.uri);
                const folderResult: string | undefined = projectConfiguration.get<string>(key);
                if (!result) {
                    result = folderResult;
                } else if (folderResult && result !== folderResult) {
                    return undefined;
                }
            }
            return result;
        } else {
            return this.getGlobalSetting(key, prefix);
        }
    }

    getDefaultRootWorkspaceSettingsPath(rootWorkspaceFolder: WorkspaceFolder): string {
        return path.join(rootWorkspaceFolder.uri.fsPath, vscodeFolder, settingsFile);
    }

    getLowestConfigurationLevel(
        projectConfiguration: WorkspaceConfiguration,
        key: string,
    ): ConfigurationTarget | undefined {
        const configuration = projectConfiguration.inspect(key);

        let lowestLevelConfiguration: ConfigurationTarget | undefined;
        if (configuration?.workspaceFolderValue !== undefined) {
            lowestLevelConfiguration = ConfigurationTarget.WorkspaceFolder;
        } else if (configuration?.workspaceValue !== undefined) {
            lowestLevelConfiguration = ConfigurationTarget.Workspace;
        } else if (configuration?.globalValue !== undefined) {
            lowestLevelConfiguration = ConfigurationTarget.Global;
        }

        return lowestLevelConfiguration;
    }
}

export const SettingsService = new SettingUtils();
