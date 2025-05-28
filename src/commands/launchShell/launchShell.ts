/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ConnectionString } from 'mongodb-connection-string-url';
import * as vscode from 'vscode';
import { isWindows } from '../../constants';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { MongoRUResourceItem } from '../../tree/azure-resources-view/documentdb/mongo-ru/MongoRUResourceItem';
import { MongoVCoreResourceItem } from '../../tree/azure-resources-view/documentdb/mongo-vcore/MongoVCoreResourceItem';
import { ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';

/**
 * Currently it only supports launching the MongoDB shell
 */
export async function launchShell(
    context: IActionContext,
    node?: DatabaseItem | CollectionItem | ClusterItemBase,
): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No database or collection selected.'));
    }

    context.telemetry.properties.experience = node.experience.api;
    context.telemetry.properties.isWindows = isWindows.toString();

    let rawConnectionString: string | undefined;

    // connection string discovery for these items can be slow, so we need to run it with a temporary description

    if (node instanceof ClusterItemBase) {
        // connecting at the account level
        // we need to discover the connection string
        rawConnectionString = await ext.state.runWithTemporaryDescription(node.id, l10n.t('Working…'), async () => {
            return node.getConnectionString();
        });
    } else {
        // node is instanceof DatabaseItem or CollectionItem and we alrady have the connection string somewhere
        const client: ClustersClient = await ClustersClient.getClient(node.cluster.id);
        rawConnectionString = client.getConnectionStringWithPassword();
    }

    if (!rawConnectionString) {
        void vscode.window.showErrorMessage(l10n.t('Failed to extract the connection string from the selected node.'));
        return;
    }
    context.valuesToMask.push(rawConnectionString);

    const connectionString: ConnectionString = new ConnectionString(rawConnectionString);

    const actualPassword = connectionString.password;
    context.valuesToMask.push(actualPassword);

    // Use unique environment variable names to avoid conflicts
    const randomSuffix = Math.floor(100000 + Math.random() * 900000).toString(); // Generate a 6-digit random number string
    const uniquePassEnvVar = `documentdb_${randomSuffix}`; // Use a lowercase, generic-looking variable name to avoid drawing attention in the shell output—this helps prevent bystanders from noticing sensitive info if they're watching the user's screen.

    // Determine appropriate environment variable syntax based on shell type
    let envVarSyntax = '';
    if (isWindows) {
        const terminalProfile = vscode.workspace.getConfiguration('terminal.integrated.defaultProfile').get('windows');

        if (terminalProfile === null || typeof terminalProfile === 'undefined') {
            // Default to PowerShell if no profile is found
            ext.outputChannel.appendLog(
                l10n.t(
                    'Default Windows terminal profile not found in VS Code settings. Assuming PowerShell for launching MongoDB shell.',
                ),
            );
            envVarSyntax = `$env:${uniquePassEnvVar}`;
            context.telemetry.properties.terminalType = 'PowerShell';
        } else if (typeof terminalProfile === 'string') {
            const profile = terminalProfile.toLowerCase();

            if (profile === 'powershell' || profile === 'pwsh' || profile === 'windows powershell') {
                // PowerShell detected
                envVarSyntax = `$env:${uniquePassEnvVar}`;
                context.telemetry.properties.terminalType = 'PowerShell';
            } else if (profile === 'cmd' || profile === 'command prompt') {
                // Command Prompt detected
                envVarSyntax = `%${uniquePassEnvVar}%`;
                context.telemetry.properties.terminalType = 'Cmd';
            } else if (profile === 'git bash') {
                // Git Bash detected
                envVarSyntax = `$${uniquePassEnvVar}`;
                context.telemetry.properties.terminalType = 'GitBash';
            } else if (profile.includes('wsl')) {
                // WSL shell detected
                envVarSyntax = `$${uniquePassEnvVar}`;
                context.telemetry.properties.terminalType = 'WSL';
            } else {
                // Unrecognized profile, default to CMD syntax
                envVarSyntax = `%${uniquePassEnvVar}%`;
                context.telemetry.properties.terminalType = 'Other';
                context.telemetry.properties.terminalProfileValue = terminalProfile;
            }
        }
    } else {
        // Unix-like environment (macOS/Linux)
        envVarSyntax = `$${uniquePassEnvVar}`;
        context.telemetry.properties.terminalType = 'Unix';
    }

    // Note to code maintainers:
    // We're using a sentinel value approach here to avoid URL encoding issues with environment variable
    // references. For example, in PowerShell the environment variable reference "$env:VAR_NAME" contains
    // a colon character (":") which gets URL encoded to "%3A" when added directly to connectionString.password.
    // This encoding breaks the environment variable reference syntax in the shell.
    //
    // By using a unique sentinel string first and then replacing it with the raw (unencoded) environment
    // variable reference after toString() is called, we ensure the shell correctly interprets the
    // environment variable.
    const PASSWORD_SENTINEL = '__MONGO_PASSWORD_PLACEHOLDER__';
    connectionString.password = PASSWORD_SENTINEL;

    // If the username or password is empty, remove them from the connection string to avoid invalid connection strings
    if (!connectionString.username || !actualPassword) {
        connectionString.password = '';
    }

    if ('databaseInfo' in node && node.databaseInfo?.name) {
        connectionString.pathname = node.databaseInfo.name;
    }

    // } else if (node instanceof CollectionItem) { // --> --eval terminates, we'd have to launch with a script etc. let's look into it latter
    //     const connStringWithDb = addDatabasePathToConnectionString(connectionStringWithUserName, node.databaseInfo.name);
    //     shellParameters = `"${connStringWithDb}" --eval 'db.getCollection("${node.collectionInfo.name}")'`
    // }

    const terminal: vscode.Terminal = vscode.window.createTerminal({
        name: `MongoDB Shell (${connectionString.username || 'default'})`, // Display actual username or a default
        hideFromUser: false,
        env: {
            [uniquePassEnvVar]: actualPassword,
        },
    });

    // Determine if TLS certificate validation should be disabled
    // This only applies to emulator connections with security disabled
    const isRegularCloudAccount = node instanceof MongoVCoreResourceItem || node instanceof MongoRUResourceItem;
    const isEmulatorWithSecurityDisabled =
        !isRegularCloudAccount &&
        node.cluster.emulatorConfiguration &&
        node.cluster.emulatorConfiguration.isEmulator &&
        node.cluster.emulatorConfiguration.disableEmulatorSecurity;

    const tlsConfiguration = isEmulatorWithSecurityDisabled ? '--tlsAllowInvalidCertificates' : '';

    // Get the connection string and replace the sentinel with the environment variable syntax
    const finalConnectionString = connectionString.toString().replace(PASSWORD_SENTINEL, envVarSyntax);

    terminal.sendText(`mongosh "${finalConnectionString}" ${tlsConfiguration}`);
    terminal.show();
}
