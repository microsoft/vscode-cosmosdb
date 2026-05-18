/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Mock } from 'vitest';
import * as vscode from 'vscode';
import {
    areAIFeaturesEnabled,
    areCopilotModelsAvailable,
    isAIFeaturesDisabledBySetting,
    isCopilotChatExtensionInstalled,
} from './copilotUtils';

// Mock the vscode module
vi.mock('vscode', () => ({
    extensions: {
        getExtension: vi.fn(),
        onDidChange: vi.fn(),
    },
    lm: {
        selectChatModels: vi.fn(),
    },
    workspace: {
        getConfiguration: vi.fn(),
        onDidChangeConfiguration: vi.fn(),
    },
    Disposable: {
        from: vi.fn((..._disposables) => ({ dispose: vi.fn() })),
    },
}));

describe('copilotUtils', () => {
    let mockConfigGet: Mock;

    beforeEach(() => {
        vi.clearAllMocks();
        mockConfigGet = vi.fn();
        (vscode.workspace.getConfiguration as Mock).mockReturnValue({
            get: mockConfigGet,
        });
    });

    describe('isAIFeaturesDisabledBySetting', () => {
        it('returns true when chat.disableAIFeatures is enabled', () => {
            mockConfigGet.mockReturnValue(true);

            expect(isAIFeaturesDisabledBySetting()).toBe(true);
            expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('chat');
            expect(mockConfigGet).toHaveBeenCalledWith('disableAIFeatures', false);
        });

        it('returns false when chat.disableAIFeatures is disabled', () => {
            mockConfigGet.mockReturnValue(false);

            expect(isAIFeaturesDisabledBySetting()).toBe(false);
        });

        it('returns false when chat.disableAIFeatures is not set (uses default value)', () => {
            // When setting is not explicitly set, VS Code returns the default value (false)
            mockConfigGet.mockReturnValue(false);

            expect(isAIFeaturesDisabledBySetting()).toBe(false);
        });
    });

    describe('isCopilotChatExtensionInstalled', () => {
        it('returns true when GitHub Copilot Chat extension is installed', () => {
            const mockExtension = { id: 'GitHub.copilot-chat' };
            (vscode.extensions.getExtension as Mock).mockReturnValue(mockExtension);

            expect(isCopilotChatExtensionInstalled()).toBe(true);
            expect(vscode.extensions.getExtension).toHaveBeenCalledWith('GitHub.copilot-chat');
        });

        it('returns false when GitHub Copilot Chat extension is not installed', () => {
            (vscode.extensions.getExtension as Mock).mockReturnValue(undefined);

            expect(isCopilotChatExtensionInstalled()).toBe(false);
            expect(vscode.extensions.getExtension).toHaveBeenCalledWith('GitHub.copilot-chat');
        });
    });

    describe('areCopilotModelsAvailable', () => {
        it('returns true when Copilot models are available', async () => {
            (vscode.lm.selectChatModels as Mock).mockResolvedValue([{ id: 'model1' }]);

            await expect(areCopilotModelsAvailable()).resolves.toBe(true);
            expect(vscode.lm.selectChatModels).toHaveBeenCalledWith({ vendor: 'copilot' });
        });

        it('returns false when no Copilot models are available', async () => {
            (vscode.lm.selectChatModels as Mock).mockResolvedValue([]);

            await expect(areCopilotModelsAvailable()).resolves.toBe(false);
        });

        it('returns false when selectChatModels throws an error', async () => {
            (vscode.lm.selectChatModels as Mock).mockRejectedValue(new Error('Not available'));

            await expect(areCopilotModelsAvailable()).resolves.toBe(false);
        });
    });

    describe('areAIFeaturesEnabled', () => {
        it('returns true when setting is not disabled and models are available', async () => {
            mockConfigGet.mockReturnValue(false); // AI features not disabled
            (vscode.extensions.getExtension as Mock).mockReturnValue({ id: 'GitHub.copilot-chat' });
            (vscode.lm.selectChatModels as Mock).mockResolvedValue([{ id: 'model1' }]);

            await expect(areAIFeaturesEnabled()).resolves.toBe(true);
        });

        it('returns true when models are available even if Chat extension is not detectable', async () => {
            // Copilot may be bundled with VS Code and not detectable via getExtension();
            // model availability alone is sufficient to consider AI features enabled.
            mockConfigGet.mockReturnValue(false);
            (vscode.extensions.getExtension as Mock).mockReturnValue(undefined);
            (vscode.lm.selectChatModels as Mock).mockResolvedValue([{ id: 'model1' }]);

            await expect(areAIFeaturesEnabled()).resolves.toBe(true);
        });

        it('returns false when AI features are disabled by setting', async () => {
            mockConfigGet.mockReturnValue(true); // AI features disabled
            (vscode.extensions.getExtension as Mock).mockReturnValue({ id: 'GitHub.copilot-chat' });
            (vscode.lm.selectChatModels as Mock).mockResolvedValue([{ id: 'model1' }]);

            await expect(areAIFeaturesEnabled()).resolves.toBe(false);
        });

        it('returns false when no models are available', async () => {
            mockConfigGet.mockReturnValue(false);
            (vscode.extensions.getExtension as Mock).mockReturnValue({ id: 'GitHub.copilot-chat' });
            (vscode.lm.selectChatModels as Mock).mockResolvedValue([]);

            await expect(areAIFeaturesEnabled()).resolves.toBe(false);
        });

        it('returns false when neither extension nor models are available', async () => {
            mockConfigGet.mockReturnValue(false);
            (vscode.extensions.getExtension as Mock).mockReturnValue(undefined);
            (vscode.lm.selectChatModels as Mock).mockResolvedValue([]);

            await expect(areAIFeaturesEnabled()).resolves.toBe(false);
        });
    });
});
