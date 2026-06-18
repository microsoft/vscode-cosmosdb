/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import * as vscode from 'vscode';
import { SettingsService } from '../services/SettingsService';
import { getBatchSizeSetting, getRootPath } from './workspacUtils';

vi.mock('../extensionVariables', () => ({
    ext: { settingsKeys: { batchSize: 'cosmosDB.batchSize' } },
}));

vi.mock('../services/SettingsService', () => ({
    SettingsService: { getSetting: vi.fn() },
}));

function setWorkspaceFolders(folders: { fsPath: string }[] | undefined): void {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
        configurable: true,
        get: () => folders?.map((f, index) => ({ uri: vscode.Uri.file(f.fsPath), name: f.fsPath, index })),
    });
}

describe('getRootPath', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        setWorkspaceFolders(undefined);
    });

    it('returns the single folder path in a single-root workspace', () => {
        setWorkspaceFolders([{ fsPath: '/root' }]);
        expect(getRootPath()).toBe(vscode.Uri.file('/root').fsPath);
    });

    it('returns undefined in a multi-root workspace', () => {
        setWorkspaceFolders([{ fsPath: '/a' }, { fsPath: '/b' }]);
        expect(getRootPath()).toBeUndefined();
    });

    it('returns undefined when there are no workspace folders', () => {
        setWorkspaceFolders(undefined);
        expect(getRootPath()).toBeUndefined();
    });
});

describe('getBatchSizeSetting', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns the configured batch size', () => {
        (SettingsService.getSetting as Mock).mockReturnValue(50);
        expect(getBatchSizeSetting()).toBe(50);
        expect(SettingsService.getSetting).toHaveBeenCalledWith('cosmosDB.batchSize');
    });

    it('throws when the batch size setting is missing', () => {
        (SettingsService.getSetting as Mock).mockReturnValue(undefined);
        expect(() => getBatchSizeSetting()).toThrow('batchSize');
    });
});
