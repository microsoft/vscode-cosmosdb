/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    areAIFeaturesEnabled,
    areCopilotModelsAvailable,
    isAIFeaturesDisabledBySetting,
    isCopilotChatExtensionInstalled,
} from './copilotUtils';

// Mock the vscode module
jest.mock('vscode', () => ({
    extensions: {
        getExtension: jest.fn(),
        onDidChange: jest.fn(),
    },
    lm: {
        selectChatModels: jest.fn(),
    },
    workspace: {
        getConfiguration: jest.fn(),
        onDidChangeConfiguration: jest.fn(),
    },
    Disposable: {
        from: jest.fn((..._disposables) => ({ dispose: jest.fn() })),
    },
}));

describe('copilotUtils', () => {
    let mockConfigGet: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockConfigGet = jest.fn();
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
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

        it('returns false when chat.disableAIFeatures is not set (defaults to false)', () => {
            mockConfigGet.mockReturnValue(undefined);

            // The function uses default value of false
            expect(isAIFeaturesDisabledBySetting()).toBe(false);
        });
    });

    describe('isCopilotChatExtensionInstalled', () => {
        it('returns true when GitHub Copilot Chat extension is installed', () => {
            const mockExtension = { id: 'GitHub.copilot-chat' };
            (vscode.extensions.getExtension as jest.Mock).mockReturnValue(mockExtension);

            expect(isCopilotChatExtensionInstalled()).toBe(true);
            expect(vscode.extensions.getExtension).toHaveBeenCalledWith('GitHub.copilot-chat');
        });

        it('returns false when GitHub Copilot Chat extension is not installed', () => {
            (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);

            expect(isCopilotChatExtensionInstalled()).toBe(false);
            expect(vscode.extensions.getExtension).toHaveBeenCalledWith('GitHub.copilot-chat');
        });
    });

    describe('areCopilotModelsAvailable', () => {
        it('returns true when Copilot models are available', async () => {
            (vscode.lm.selectChatModels as jest.Mock).mockResolvedValue([{ id: 'model1' }]);

            await expect(areCopilotModelsAvailable()).resolves.toBe(true);
            expect(vscode.lm.selectChatModels).toHaveBeenCalledWith({ vendor: 'copilot' });
        });

        it('returns false when no Copilot models are available', async () => {
            (vscode.lm.selectChatModels as jest.Mock).mockResolvedValue([]);

            await expect(areCopilotModelsAvailable()).resolves.toBe(false);
        });

        it('returns false when selectChatModels throws an error', async () => {
            (vscode.lm.selectChatModels as jest.Mock).mockRejectedValue(new Error('Not available'));

            await expect(areCopilotModelsAvailable()).resolves.toBe(false);
        });
    });

    describe('areAIFeaturesEnabled', () => {
        it('returns true when setting is not disabled, Chat extension is installed, and models are available', async () => {
            mockConfigGet.mockReturnValue(false); // AI features not disabled
            (vscode.extensions.getExtension as jest.Mock).mockReturnValue({ id: 'GitHub.copilot-chat' });
            (vscode.lm.selectChatModels as jest.Mock).mockResolvedValue([{ id: 'model1' }]);

            await expect(areAIFeaturesEnabled()).resolves.toBe(true);
        });

        it('returns false when AI features are disabled by setting', async () => {
            mockConfigGet.mockReturnValue(true); // AI features disabled
            (vscode.extensions.getExtension as jest.Mock).mockReturnValue({ id: 'GitHub.copilot-chat' });
            (vscode.lm.selectChatModels as jest.Mock).mockResolvedValue([{ id: 'model1' }]);

            await expect(areAIFeaturesEnabled()).resolves.toBe(false);
        });

        it('returns false when Chat extension is installed but no models available', async () => {
            mockConfigGet.mockReturnValue(false);
            (vscode.extensions.getExtension as jest.Mock).mockReturnValue({ id: 'GitHub.copilot-chat' });
            (vscode.lm.selectChatModels as jest.Mock).mockResolvedValue([]);

            await expect(areAIFeaturesEnabled()).resolves.toBe(false);
        });

        it('returns false when Chat extension is not installed', async () => {
            mockConfigGet.mockReturnValue(false);
            (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
            (vscode.lm.selectChatModels as jest.Mock).mockResolvedValue([{ id: 'model1' }]);

            await expect(areAIFeaturesEnabled()).resolves.toBe(false);
        });

        it('returns false when neither extension nor models are available', async () => {
            mockConfigGet.mockReturnValue(false);
            (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
            (vscode.lm.selectChatModels as jest.Mock).mockResolvedValue([]);

            await expect(areAIFeaturesEnabled()).resolves.toBe(false);
        });
    });
});
