/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { SettingsService } from '../services/SettingsService';
import { AuthenticationMethod, getPreferredAuthenticationMethod } from './AuthenticationMethod';

const AUTH_KEY = 'azureDatabases.cosmosDB.preferredAuthenticationMethod';
const DEPRECATED_KEY = 'azureDatabases.useCosmosOAuth';

vi.mock('../extensionVariables', () => ({
    ext: { settingsKeys: { cosmosDbAuthentication: 'azureDatabases.cosmosDB.preferredAuthenticationMethod' } },
}));

vi.mock('../services/SettingsService', () => ({
    SettingsService: { getSetting: vi.fn(), updateGlobalSetting: vi.fn().mockResolvedValue(undefined) },
}));

/** Wires `getSetting` to return per-key values. */
function stubSettings(values: { auth?: AuthenticationMethod; deprecatedOAuth?: boolean }): void {
    (SettingsService.getSetting as Mock).mockImplementation((key: string) => {
        if (key === AUTH_KEY) {
            return values.auth;
        }
        if (key === DEPRECATED_KEY) {
            return values.deprecatedOAuth;
        }
        return undefined;
    });
}

describe('getPreferredAuthenticationMethod', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('defaults to "auto" when nothing is configured', () => {
        stubSettings({});
        expect(getPreferredAuthenticationMethod()).toBe(AuthenticationMethod.auto);
        expect(SettingsService.updateGlobalSetting).not.toHaveBeenCalled();
    });

    it('returns the stored method when set and no deprecated flag is present', () => {
        stubSettings({ auth: AuthenticationMethod.accountKey });
        expect(getPreferredAuthenticationMethod()).toBe(AuthenticationMethod.accountKey);
        expect(SettingsService.updateGlobalSetting).not.toHaveBeenCalled();
    });

    it('migrates the deprecated OAuth flag to entraId when the method is still "auto"', () => {
        stubSettings({ deprecatedOAuth: true });
        expect(getPreferredAuthenticationMethod()).toBe(AuthenticationMethod.entraId);
        expect(SettingsService.updateGlobalSetting).toHaveBeenCalledWith(AUTH_KEY, AuthenticationMethod.entraId);
        expect(SettingsService.updateGlobalSetting).toHaveBeenCalledWith(DEPRECATED_KEY, undefined);
    });

    it('clears the deprecated flag without overriding an explicitly chosen method', () => {
        stubSettings({ auth: AuthenticationMethod.accountKey, deprecatedOAuth: true });
        expect(getPreferredAuthenticationMethod()).toBe(AuthenticationMethod.accountKey);
        // Does not migrate to entraId because a non-auto method was already chosen.
        expect(SettingsService.updateGlobalSetting).not.toHaveBeenCalledWith(AUTH_KEY, AuthenticationMethod.entraId);
        // Still clears the obsolete setting.
        expect(SettingsService.updateGlobalSetting).toHaveBeenCalledWith(DEPRECATED_KEY, undefined);
    });
});
