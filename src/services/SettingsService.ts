/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import * as vscode from 'vscode';

export const vscodeFolder: string = '.vscode';
export const settingsFile: string = 'settings.json';

export class SettingUtils {
    /**
     * Directly updates one of the user's `Global` configuration settings.
     * @param key The key of the setting to update
     * @param value The value of the setting to update
     * @param prefix The optional extension prefix.
     */
    async updateGlobalSetting<T = string>(key: string, value: T, prefix?: string): Promise<void> {
        const projectConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(prefix);
        await projectConfiguration.update(key, value, vscode.ConfigurationTarget.Global);
    }

    /**
     * Directly retrieves one of the user's `Global` or `Default` configuration settings.
     * @param key The key of the setting to retrieve
     * @param prefix The optional extension prefix.
     */
    getGlobalSetting<T>(key: string, prefix?: string): T | undefined {
        const projectConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(prefix);
        const result: { globalValue?: T; defaultValue?: T } | undefined = projectConfiguration.inspect<T>(key);
        return result?.globalValue === undefined ? result?.defaultValue : result?.globalValue;
    }

    /**
     * Directly updates one of the user's `Workspace` or `WorkspaceFolder` settings.
     * @param key The key of the setting to update
     * @param value The value of the setting to update
     * @param fsPath The path of the workspace configuration settings
     * @param targetSetting The optional workspace setting to target. Uses the `Workspace` configuration target unless otherwise specified
     * @param prefix The optional extension prefix.
     */
    async updateWorkspaceSetting<T = string>(
        key: string,
        value: T,
        prefix?: string,
        fsPath?: string,
        targetSetting: vscode.ConfigurationTarget.Workspace | vscode.ConfigurationTarget.WorkspaceFolder = vscode
            .ConfigurationTarget.Workspace,
    ): Promise<void> {
        const projectConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(
            prefix,
            fsPath ? vscode.Uri.file(fsPath) : undefined,
        );
        await projectConfiguration.update(key, value, targetSetting);
    }

    /**
     * Iteratively retrieves one of the user's workspace settings - sequentially checking for a defined value starting from the `WorkspaceFolder` up to the provided target configuration limit.
     * @param key The key of the setting to retrieve
     * @param fsPath The optional path of the workspace configuration settings
     * @param targetLimit The optional target configuration limit (inclusive). Uses the `Workspace` configuration target unless otherwise specified
     * @param prefix The optional extension prefix
     */
    getWorkspaceSetting<T>(
        key: string,
        prefix?: string,
        fsPath?: string,
        targetLimit: vscode.ConfigurationTarget.Workspace | vscode.ConfigurationTarget.WorkspaceFolder = vscode
            .ConfigurationTarget.Workspace,
    ): T | undefined {
        const projectConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(
            prefix,
            fsPath ? vscode.Uri.file(fsPath) : undefined,
        );

        const configurationLevel = this.getLowestConfigurationLevel(projectConfiguration, key);
        if (!configurationLevel || configurationLevel < targetLimit) {
            return undefined;
        }

        return projectConfiguration.get<T>(key);
    }

    /**
     * Iteratively retrieves one of the user's settings - sequentially checking for a defined value starting from the `WorkspaceFolder` up to the `Global` configuration target.
     * @param key The key of the setting to retrieve
     * @param fsPath The optional path of the workspace configuration settings
     * @param prefix The optional extension prefix.
     */
    getSetting<T>(key: string, prefix?: string, fsPath?: string): T | undefined {
        const projectConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(
            prefix,
            fsPath ? vscode.Uri.file(fsPath) : undefined,
        );
        return projectConfiguration.get<T>(key);
    }

    /**
     * Searches through all open folders and gets the current workspace setting (as long as there are no conflicts)
     */
    getWorkspaceSettingFromAnyFolder(key: string, prefix?: string): string | undefined {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            let result: string | undefined;
            for (const folder of vscode.workspace.workspaceFolders) {
                const projectConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(
                    prefix,
                    folder.uri,
                );
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

    getDefaultRootWorkspaceSettingsPath(rootWorkspaceFolder: vscode.WorkspaceFolder): string {
        return path.join(rootWorkspaceFolder.uri.fsPath, vscodeFolder, settingsFile);
    }

    getLowestConfigurationLevel(
        projectConfiguration: vscode.WorkspaceConfiguration,
        key: string,
    ): vscode.ConfigurationTarget | undefined {
        const configuration = projectConfiguration.inspect(key);

        let lowestLevelConfiguration: vscode.ConfigurationTarget | undefined;
        if (configuration?.workspaceFolderValue !== undefined) {
            lowestLevelConfiguration = vscode.ConfigurationTarget.WorkspaceFolder;
        } else if (configuration?.workspaceValue !== undefined) {
            lowestLevelConfiguration = vscode.ConfigurationTarget.Workspace;
        } else if (configuration?.globalValue !== undefined) {
            lowestLevelConfiguration = vscode.ConfigurationTarget.Global;
        }

        return lowestLevelConfiguration;
    }
}

export const SettingsService = new SettingUtils();
