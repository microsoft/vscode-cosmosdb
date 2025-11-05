/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import vscode from 'vscode';
import { ext } from '../extensionVariables';

export enum AuthenticationMethod {
    auto = 'auto',
    accountKey = 'accountKey',
    entraId = 'entraId',
    managedIdentity = 'managedIdentity',
}

export function getPreferredAuthenticationMethod(): AuthenticationMethod {
    const configuration = vscode.workspace.getConfiguration();
    //migrate old setting
    const deprecatedOauthSetting = configuration.get<boolean>('azureDatabases.useCosmosOAuth');
    let preferredAuthMethod = configuration.get<AuthenticationMethod>(
        ext.settingsKeys.cosmosDbAuthentication,
        AuthenticationMethod.auto,
    );

    if (deprecatedOauthSetting) {
        if (preferredAuthMethod === AuthenticationMethod.auto) {
            preferredAuthMethod = AuthenticationMethod.entraId;
            configuration.update(ext.settingsKeys.cosmosDbAuthentication, preferredAuthMethod, true);
        }
        configuration.update('azureDatabases.useCosmosOAuth', undefined, true);
    }

    return preferredAuthMethod;
}
