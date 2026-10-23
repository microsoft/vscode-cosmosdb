/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Mock } from 'vitest';
import * as vscode from 'vscode';
import {
    getMigrationFeatureDefaultEnabled,
    isMigrationFeatureEnabled,
    isPreReleaseBuild,
    MIGRATION_ENABLED_SETTING_KEY,
    MIGRATION_ENABLED_SETTING_SECTION,
} from './migrationFeatureFlag';

vi.mock('vscode', () => ({
    extensions: {
        getExtension: vi.fn(),
    },
    workspace: {
        getConfiguration: vi.fn(),
    },
}));

describe('migrationFeatureFlag', () => {
    let mockGetExtension: Mock;
    let mockGetSetting: Mock;

    beforeEach(() => {
        vi.restoreAllMocks();

        mockGetExtension = vi.fn();
        mockGetSetting = vi.fn();

        vi.spyOn(vscode.extensions, 'getExtension').mockImplementation(mockGetExtension);
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
            get: mockGetSetting,
        } as unknown as vscode.WorkspaceConfiguration);
    });

    describe('isPreReleaseBuild', () => {
        it('returns true when extension package metadata marks preview=true', () => {
            mockGetExtension.mockReturnValue({ packageJSON: { preview: true } });

            expect(isPreReleaseBuild()).toBe(true);
        });

        it('returns false when extension package metadata marks preview=false', () => {
            mockGetExtension.mockReturnValue({ packageJSON: { preview: false } });

            expect(isPreReleaseBuild()).toBe(false);
        });

        it('returns false when extension metadata is unavailable', () => {
            mockGetExtension.mockReturnValue(undefined);

            expect(isPreReleaseBuild()).toBe(false);
        });
    });

    describe('getMigrationFeatureDefaultEnabled', () => {
        it('defaults to enabled for pre-release builds', () => {
            mockGetExtension.mockReturnValue({ packageJSON: { preview: true } });

            expect(getMigrationFeatureDefaultEnabled()).toBe(true);
        });

        it('defaults to disabled for stable builds', () => {
            mockGetExtension.mockReturnValue({ packageJSON: { preview: false } });

            expect(getMigrationFeatureDefaultEnabled()).toBe(false);
        });
    });

    describe('isMigrationFeatureEnabled', () => {
        it('passes pre-release default=true when reading the setting', () => {
            mockGetExtension.mockReturnValue({ packageJSON: { preview: true } });
            mockGetSetting.mockReturnValue(true);

            expect(isMigrationFeatureEnabled()).toBe(true);
            expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(MIGRATION_ENABLED_SETTING_SECTION);
            expect(mockGetSetting).toHaveBeenCalledWith(MIGRATION_ENABLED_SETTING_KEY, true);
        });

        it('passes stable default=false when reading the setting', () => {
            mockGetExtension.mockReturnValue({ packageJSON: { preview: false } });
            mockGetSetting.mockReturnValue(false);

            expect(isMigrationFeatureEnabled()).toBe(false);
            expect(mockGetSetting).toHaveBeenCalledWith(MIGRATION_ENABLED_SETTING_KEY, false);
        });

        it('honors explicit user override=true on stable builds', () => {
            mockGetExtension.mockReturnValue({ packageJSON: { preview: false } });
            mockGetSetting.mockReturnValue(true);

            expect(isMigrationFeatureEnabled()).toBe(true);
        });

        it('honors explicit user override=false on pre-release builds', () => {
            mockGetExtension.mockReturnValue({ packageJSON: { preview: true } });
            mockGetSetting.mockReturnValue(false);

            expect(isMigrationFeatureEnabled()).toBe(false);
        });

        it('falls back to stable-safe default=false when metadata is unavailable and setting is unset', () => {
            mockGetExtension.mockReturnValue(undefined);
            mockGetSetting.mockReturnValue(undefined);

            expect(isMigrationFeatureEnabled()).toBe(false);
            expect(mockGetSetting).toHaveBeenCalledWith(MIGRATION_ENABLED_SETTING_KEY, false);
        });
    });
});
