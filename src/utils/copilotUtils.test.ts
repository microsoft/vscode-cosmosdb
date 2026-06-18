/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Mock } from 'vitest';
import * as vscode from 'vscode';
import { SettingsService } from '../services/SettingsService';
import {
    areAIFeaturesEnabled,
    areCopilotModelsAvailable,
    isAIFeaturesDisabledBySetting,
    isCopilotChatExtensionInstalled,
    onCopilotAvailabilityChanged,
} from './copilotUtils';

// Mock the vscode module
vi.mock('vscode', () => ({
    extensions: {
        getExtension: vi.fn(),
        onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    },
    lm: {
        selectChatModels: vi.fn(),
        onDidChangeChatModels: vi.fn(() => ({ dispose: vi.fn() })),
    },
    workspace: {
        getConfiguration: vi.fn(),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    },
    Disposable: {
        from: vi.fn((..._disposables) => ({ dispose: vi.fn() })),
    },
}));

vi.mock('../services/SettingsService', () => ({
    SettingsService: { getSetting: vi.fn() },
}));

describe('copilotUtils', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: AI features not disabled by setting.
        (SettingsService.getSetting as Mock).mockReturnValue(false);
    });

    describe('isAIFeaturesDisabledBySetting', () => {
        it('returns true when chat.disableAIFeatures is enabled', () => {
            (SettingsService.getSetting as Mock).mockReturnValue(true);

            expect(isAIFeaturesDisabledBySetting()).toBe(true);
            expect(SettingsService.getSetting).toHaveBeenCalledWith('disableAIFeatures', 'chat');
        });

        it('returns false when chat.disableAIFeatures is disabled', () => {
            (SettingsService.getSetting as Mock).mockReturnValue(false);

            expect(isAIFeaturesDisabledBySetting()).toBe(false);
        });

        it('returns false when chat.disableAIFeatures is not set (uses default value)', () => {
            // When the setting is not explicitly set, SettingsService returns undefined → defaults to false.
            (SettingsService.getSetting as Mock).mockReturnValue(undefined);

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
            (SettingsService.getSetting as Mock).mockReturnValue(false); // AI features not disabled
            (vscode.extensions.getExtension as Mock).mockReturnValue({ id: 'GitHub.copilot-chat' });
            (vscode.lm.selectChatModels as Mock).mockResolvedValue([{ id: 'model1' }]);

            await expect(areAIFeaturesEnabled()).resolves.toBe(true);
        });

        it('returns true when models are available even if Chat extension is not detectable', async () => {
            // Copilot may be bundled with VS Code and not detectable via getExtension();
            // model availability alone is sufficient to consider AI features enabled.
            (SettingsService.getSetting as Mock).mockReturnValue(false);
            (vscode.extensions.getExtension as Mock).mockReturnValue(undefined);
            (vscode.lm.selectChatModels as Mock).mockResolvedValue([{ id: 'model1' }]);

            await expect(areAIFeaturesEnabled()).resolves.toBe(true);
        });

        it('returns false when AI features are disabled by setting', async () => {
            (SettingsService.getSetting as Mock).mockReturnValue(true); // AI features disabled
            (vscode.extensions.getExtension as Mock).mockReturnValue({ id: 'GitHub.copilot-chat' });
            (vscode.lm.selectChatModels as Mock).mockResolvedValue([{ id: 'model1' }]);

            await expect(areAIFeaturesEnabled()).resolves.toBe(false);
        });

        it('returns false when no models are available', async () => {
            (SettingsService.getSetting as Mock).mockReturnValue(false);
            (vscode.extensions.getExtension as Mock).mockReturnValue({ id: 'GitHub.copilot-chat' });
            (vscode.lm.selectChatModels as Mock).mockResolvedValue([]);

            await expect(areAIFeaturesEnabled()).resolves.toBe(false);
        });

        it('returns false when neither extension nor models are available', async () => {
            (SettingsService.getSetting as Mock).mockReturnValue(false);
            (vscode.extensions.getExtension as Mock).mockReturnValue(undefined);
            (vscode.lm.selectChatModels as Mock).mockResolvedValue([]);

            await expect(areAIFeaturesEnabled()).resolves.toBe(false);
        });
    });

    describe('onCopilotAvailabilityChanged', () => {
        it('registers extension, configuration and model listeners and returns a disposable', () => {
            (vscode.extensions.getExtension as Mock).mockReturnValue(undefined);

            const disposable = onCopilotAvailabilityChanged(vi.fn());

            expect(vscode.extensions.onDidChange).toHaveBeenCalled();
            expect(vscode.workspace.onDidChangeConfiguration).toHaveBeenCalled();
            expect(vscode.lm.onDidChangeChatModels).toHaveBeenCalled();
            expect(vscode.Disposable.from).toHaveBeenCalled();
            expect(typeof disposable.dispose).toBe('function');
        });

        it('invokes the callback with true when the configuration change makes models available', async () => {
            (SettingsService.getSetting as Mock).mockReturnValue(false); // not disabled
            (vscode.lm.selectChatModels as Mock).mockResolvedValue([{ id: 'model1' }]);

            const callback = vi.fn();
            onCopilotAvailabilityChanged(callback);

            // Grab the configuration listener registered inside onCopilotAvailabilityChanged.
            const configListener = (vscode.workspace.onDidChangeConfiguration as Mock).mock.calls[0][0] as (e: {
                affectsConfiguration: (s: string) => boolean;
            }) => void;
            configListener({ affectsConfiguration: () => true });

            // Allow the async availability check to settle.
            await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(true));
        });

        it('ignores configuration changes that do not affect chat.disableAIFeatures', () => {
            const callback = vi.fn();
            onCopilotAvailabilityChanged(callback);

            const configListener = (vscode.workspace.onDidChangeConfiguration as Mock).mock.calls[0][0] as (e: {
                affectsConfiguration: (s: string) => boolean;
            }) => void;
            configListener({ affectsConfiguration: () => false });

            expect(callback).not.toHaveBeenCalled();
        });

        it('retries when enabling but models are not yet available, then succeeds', async () => {
            vi.useFakeTimers();
            try {
                (SettingsService.getSetting as Mock).mockReturnValue(false); // not disabled → enabling scenario
                // First check: no models; subsequent checks: available.
                (vscode.lm.selectChatModels as Mock).mockResolvedValueOnce([]).mockResolvedValue([{ id: 'model1' }]);

                const callback = vi.fn();
                onCopilotAvailabilityChanged(callback);

                const modelListener = (vscode.lm.onDidChangeChatModels as Mock).mock.calls[0][0] as () => void;
                modelListener();

                // Drain the first (failing) availability check, then the scheduled retry.
                await vi.runAllTimersAsync();

                expect(callback).toHaveBeenCalledWith(true);
            } finally {
                vi.useRealTimers();
            }
        });
    });
});
