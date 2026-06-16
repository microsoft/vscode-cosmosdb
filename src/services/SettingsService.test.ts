/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { SettingsService, settingsFile, vscodeFolder } from './SettingsService';

/**
 * Build a fake WorkspaceConfiguration whose get/inspect/update behaviour is driven by the
 * supplied maps. Only the members exercised by SettingUtils are implemented.
 */
function fakeConfig(options: {
    get?: Record<string, unknown>;
    inspect?: Record<string, unknown>;
    onUpdate?: (key: string, value: unknown, target?: vscode.ConfigurationTarget) => void;
}): vscode.WorkspaceConfiguration {
    return {
        get: vi.fn((key: string) => options.get?.[key]),
        inspect: vi.fn((key: string) => options.inspect?.[key]),
        update: vi.fn(async (key: string, value: unknown, target?: vscode.ConfigurationTarget) => {
            options.onUpdate?.(key, value, target);
        }),
        has: vi.fn(() => true),
    } as unknown as vscode.WorkspaceConfiguration;
}

describe('SettingUtils', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('getGlobalSetting', () => {
        it('prefers the global value when it is defined', () => {
            vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(
                fakeConfig({ inspect: { key: { globalValue: 'global', defaultValue: 'default' } } }),
            );
            expect(SettingsService.getGlobalSetting<string>('key')).toBe('global');
        });

        it('falls back to the default value when the global value is undefined', () => {
            vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(
                fakeConfig({ inspect: { key: { globalValue: undefined, defaultValue: 'default' } } }),
            );
            expect(SettingsService.getGlobalSetting<string>('key')).toBe('default');
        });
    });

    describe('getSetting', () => {
        it('returns the merged configuration value', () => {
            vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(fakeConfig({ get: { key: 'value' } }));
            expect(SettingsService.getSetting<string>('key')).toBe('value');
        });
    });

    describe('updateGlobalSetting', () => {
        it('updates with the Global configuration target', async () => {
            const onUpdate = vi.fn();
            vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(fakeConfig({ onUpdate }));
            await SettingsService.updateGlobalSetting('key', 'value');
            expect(onUpdate).toHaveBeenCalledWith('key', 'value', vscode.ConfigurationTarget.Global);
        });
    });

    describe('getLowestConfigurationLevel', () => {
        it('returns WorkspaceFolder when a folder value exists', () => {
            const config = fakeConfig({ inspect: { key: { workspaceFolderValue: 'x' } } });
            expect(SettingsService.getLowestConfigurationLevel(config, 'key')).toBe(
                vscode.ConfigurationTarget.WorkspaceFolder,
            );
        });

        it('returns Workspace when only a workspace value exists', () => {
            const config = fakeConfig({ inspect: { key: { workspaceValue: 'x' } } });
            expect(SettingsService.getLowestConfigurationLevel(config, 'key')).toBe(
                vscode.ConfigurationTarget.Workspace,
            );
        });

        it('returns Global when only a global value exists', () => {
            const config = fakeConfig({ inspect: { key: { globalValue: 'x' } } });
            expect(SettingsService.getLowestConfigurationLevel(config, 'key')).toBe(vscode.ConfigurationTarget.Global);
        });

        it('returns undefined when nothing is set', () => {
            const config = fakeConfig({ inspect: { key: {} } });
            expect(SettingsService.getLowestConfigurationLevel(config, 'key')).toBeUndefined();
        });
    });

    describe('getWorkspaceSetting', () => {
        it('returns the value when the configuration level meets the target limit', () => {
            vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(
                fakeConfig({ get: { key: 'value' }, inspect: { key: { workspaceValue: 'value' } } }),
            );
            expect(SettingsService.getWorkspaceSetting<string>('key')).toBe('value');
        });

        it('returns undefined when the configuration level is below the target limit', () => {
            // Only a global value exists, but the default target limit is Workspace.
            vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(
                fakeConfig({ get: { key: 'value' }, inspect: { key: { globalValue: 'value' } } }),
            );
            expect(SettingsService.getWorkspaceSetting<string>('key')).toBeUndefined();
        });
    });

    describe('getWorkspaceSettingFromAnyFolder', () => {
        afterEach(() => {
            vi.unstubAllGlobals();
        });

        it('returns the global setting when there are no workspace folders', () => {
            vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(
                fakeConfig({ inspect: { key: { globalValue: 'global' } } }),
            );
            // No workspaceFolders → falls back to getGlobalSetting.
            expect(SettingsService.getWorkspaceSettingFromAnyFolder('key')).toBe('global');
        });

        it('returns the single consistent value across folders', () => {
            Object.defineProperty(vscode.workspace, 'workspaceFolders', {
                configurable: true,
                get: () => [
                    { uri: vscode.Uri.file('/a'), name: 'a', index: 0 },
                    { uri: vscode.Uri.file('/b'), name: 'b', index: 1 },
                ],
            });
            vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(fakeConfig({ get: { key: 'same' } }));
            expect(SettingsService.getWorkspaceSettingFromAnyFolder('key')).toBe('same');
        });

        it('returns undefined when folders disagree', () => {
            let call = 0;
            Object.defineProperty(vscode.workspace, 'workspaceFolders', {
                configurable: true,
                get: () => [
                    { uri: vscode.Uri.file('/a'), name: 'a', index: 0 },
                    { uri: vscode.Uri.file('/b'), name: 'b', index: 1 },
                ],
            });
            vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(() =>
                fakeConfig({ get: { key: call++ === 0 ? 'first' : 'second' } }),
            );
            expect(SettingsService.getWorkspaceSettingFromAnyFolder('key')).toBeUndefined();
        });
    });

    describe('getDefaultRootWorkspaceSettingsPath', () => {
        it('joins the folder path with .vscode/settings.json', () => {
            const folder = { uri: vscode.Uri.file('/root'), name: 'root', index: 0 } as vscode.WorkspaceFolder;
            const expected = path.join(folder.uri.fsPath, vscodeFolder, settingsFile);
            expect(SettingsService.getDefaultRootWorkspaceSettingsPath(folder)).toBe(expected);
        });
    });
});
