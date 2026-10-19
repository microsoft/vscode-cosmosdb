/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { DataModelerProjectService } from '../../services/DataModelerProjectService';
import { deleteAllDataModelerData } from './deleteAllDataModelerData';

const { openTabs } = vi.hoisted(() => ({ openTabs: new Set<{ dispose: () => void }>() }));
vi.mock('../../panels/DataModelingWizardTab', () => ({
    DataModelingWizardTab: { openTabs },
}));
vi.mock('../../services/DataModelerProjectService', () => ({
    DataModelerProjectService: { deleteAllData: vi.fn() },
}));

const context: IActionContext = {
    valuesToMask: [],
    telemetry: { properties: {}, measurements: {} },
    errorHandling: { issueProperties: {} },
    ui: {
        onDidFinishPrompt: vi.fn(),
        showQuickPick: vi.fn(),
        showInputBox: vi.fn(),
        showWarningMessage: vi.fn(),
        showOpenDialog: vi.fn(),
        showWorkspaceFolderPick: vi.fn(),
    },
};

beforeEach(() => {
    vi.clearAllMocks();
    openTabs.clear();
    vi.mocked(DataModelerProjectService.deleteAllData).mockResolvedValue(undefined);
    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
    vi.spyOn(vscode.window, 'showWarningMessage').mockImplementation(async (_message, _options, ...items) => items[0]);
});

afterEach(() => vi.restoreAllMocks());

describe('deleteAllDataModelerData', () => {
    it('requires modal confirmation, closes every modeler tab, and reports success only after deletion', async () => {
        const dispose = vi.fn(() => {
            expect(DataModelerProjectService.deleteAllData).not.toHaveBeenCalled();
        });
        openTabs.add({ dispose });
        openTabs.add({ dispose });
        vi.mocked(DataModelerProjectService.deleteAllData).mockImplementation(async () => {
            expect(dispose).toHaveBeenCalledTimes(2);
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        });

        await deleteAllDataModelerData(context);

        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            expect.stringContaining('Deployed databases and containers will not be deleted'),
            { modal: true },
            { title: 'Delete All' },
            { title: 'Cancel', isCloseAffordance: true },
        );
        expect(DataModelerProjectService.deleteAllData).toHaveBeenCalledOnce();
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            'All local Data Modeler data has been deleted.',
        );
    });

    it.each(['cancel', 'dismiss'])('leaves tabs and saved data untouched on %s', async (action) => {
        const dispose = vi.fn();
        openTabs.add({ dispose });
        vi.mocked(vscode.window.showWarningMessage).mockImplementation(async (_message, _options, ...items) =>
            action === 'cancel' ? items[1] : undefined,
        );

        await deleteAllDataModelerData(context);

        expect(dispose).not.toHaveBeenCalled();
        expect(DataModelerProjectService.deleteAllData).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('propagates storage errors without reporting success', async () => {
        const error = vscode.FileSystemError.NoPermissions();
        vi.mocked(DataModelerProjectService.deleteAllData).mockRejectedValueOnce(error);
        await expect(deleteAllDataModelerData(context)).rejects.toBe(error);
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });
});
