/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../extensionVariables';
import { SettingsService } from '../services/SettingsService';

export enum AuthenticationMethod {
    auto = 'auto',
    accountKey = 'accountKey',
    entraId = 'entraId',
    managedIdentity = 'managedIdentity',
}

const DEPRECATED_OAUTH_SETTING = 'azureDatabases.useCosmosOAuth';

export function getPreferredAuthenticationMethod(): AuthenticationMethod {
    //migrate old setting
    const deprecatedOauthSetting = SettingsService.getSetting<boolean>(DEPRECATED_OAUTH_SETTING);
    let preferredAuthMethod =
        SettingsService.getSetting<AuthenticationMethod>(ext.settingsKeys.cosmosDbAuthentication) ??
        AuthenticationMethod.auto;

    if (deprecatedOauthSetting) {
        if (preferredAuthMethod === AuthenticationMethod.auto) {
            preferredAuthMethod = AuthenticationMethod.entraId;
            void SettingsService.updateGlobalSetting(ext.settingsKeys.cosmosDbAuthentication, preferredAuthMethod);
        }
        void SettingsService.updateGlobalSetting<boolean | undefined>(DEPRECATED_OAUTH_SETTING, undefined);
    }

    return preferredAuthMethod;
}
