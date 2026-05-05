/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Master switch to control whether third-party (non-Copilot) language models are allowed.
 * When false, all model selection is restricted to `{ vendor: 'copilot' }`.
 * When true, all available models (including 3P) are returned.
 */
const allow3pModels = false;

/**
 * GitHub Copilot extension IDs
 *
 * Note: The main GitHub Copilot extension (GitHub.copilot) is not detectable via vscode.extensions.getExtension().
 * It does not appear in vscode.extensions.all either. Therefore, we rely on areCopilotModelsAvailable()
 * as the primary detection method, which checks if Copilot language models are accessible.
 */
const COPILOT_CHAT_EXTENSION_ID = 'GitHub.copilot-chat';

/**
 * Checks if the user has disabled AI features via the VS Code setting.
 * @returns true if AI features are disabled by the user, false otherwise
 */
export function isAIFeaturesDisabledBySetting(): boolean {
    const config = vscode.workspace.getConfiguration('chat');
    return config.get<boolean>('disableAIFeatures', false);
}

/**
 * Checks if the GitHub Copilot Chat extension is installed.
 * @returns true if the Copilot Chat extension is installed, false otherwise
 */
export function isCopilotChatExtensionInstalled(): boolean {
    const copilotChatExtension = vscode.extensions.getExtension(COPILOT_CHAT_EXTENSION_ID);
    return copilotChatExtension !== undefined;
}

/**
 * Checks if any Copilot language models are available (indicates Copilot is active and functional).
 * This is the most reliable way to check if AI features should be enabled.
 * @returns Promise<boolean> true if Copilot models are available, false otherwise
 */
export async function areCopilotModelsAvailable(): Promise<boolean> {
    try {
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        return models.length > 0;
    } catch {
        return false;
    }
}

/**
 * Returns the list of available language models, filtered by the {@link allow3pModels} switch.
 * When the switch is off only Copilot (1P) models are returned.
 *
 * If a `preferredModelId` is supplied, the matching model is returned first.
 * When the preferred model is not found in the list it is silently ignored and the
 * first model in the filtered list is used instead.
 */
export async function getAvailableLanguageModels(preferredModelId?: string): Promise<vscode.LanguageModelChat[]> {
    const selector: vscode.LanguageModelChatSelector = allow3pModels ? {} : { vendor: 'copilot' };
    const models = await vscode.lm.selectChatModels(selector);

    if (preferredModelId && models.length > 0) {
        const preferredIndex = models.findIndex((m) => m.id === preferredModelId);
        if (preferredIndex > 0) {
            // Move the preferred model to the front so callers can just use models[0]
            const [preferred] = models.splice(preferredIndex, 1);
            models.unshift(preferred);
        }
        // If preferredIndex === -1, the model wasn't found — fall through to default order
    }

    return models;
}

/**
 * Checks if all requirements for AI features are met:
 * 1. AI features are not disabled by the user via the 'chat.disableAIFeatures' setting
 * 2. GitHub Copilot Chat extension is installed (required for chat participant)
 * 3. Copilot language models are available
 *
 * Note: We use areCopilotModelsAvailable() as the primary check since the
 * GitHub.copilot extension is not detectable via getExtension().
 * @returns Promise<boolean> true if all requirements are met, false otherwise
 */
export async function areAIFeaturesEnabled(): Promise<boolean> {
    if (isAIFeaturesDisabledBySetting()) {
        return false;
    }
    return isCopilotChatExtensionInstalled() && (await areCopilotModelsAvailable());
}

/**
 * Checks AI feature availability with retry logic for enabling scenarios.
 *
 * When the user re-enables AI features (unchecks 'chat.disableAIFeatures') or installs/enables
 * the Copilot extension, the language models may not be immediately available. This function
 * retries the check a few times to allow the models to become ready before giving up.
 *
 * @param callback Function to call with the availability result
 * @param shouldRetry Whether to use retry logic (true for enabling scenarios, false for disabling)
 * @param retryCount Number of retries remaining (default: 3)
 * @param retryDelayMs Delay between retries in milliseconds (default: 500ms)
 */
async function checkAIFeaturesWithRetry(
    callback: (available: boolean) => void,
    shouldRetry: boolean,
    retryCount: number = 3,
    retryDelayMs: number = 500,
): Promise<void> {
    const available = await areAIFeaturesEnabled();

    if (available) {
        callback(true);
        return;
    }

    // Only retry if we're in an "enabling" scenario (extension just installed/enabled or setting just enabled).
    // Don't retry when disabling - the unavailability is intentional, not transient.
    // Disabling or uninstalling currently requires restarting VS Code to fully take effect.
    if (shouldRetry && !isAIFeaturesDisabledBySetting() && retryCount > 0) {
        setTimeout(() => {
            void checkAIFeaturesWithRetry(callback, shouldRetry, retryCount - 1, retryDelayMs);
        }, retryDelayMs);
        return;
    }

    callback(false);
}

/**
 * Registers listeners for extension and configuration changes to detect when Copilot availability changes.
 * This includes:
 * - Extension install/uninstall/enable/disable
 * - Changes to the 'chat.disableAIFeatures' setting
 *
 * Note: When the user re-enables AI features or an extension is installed/enabled, Copilot models
 * may take a moment to become available. The listeners use retry logic to handle this delay.
 * When disabling/uninstalling, the callback is invoked immediately without retries.
 *
 * @param callback Function to call when Copilot availability changes
 * @returns Disposable to unregister the listeners
 */
export function onCopilotAvailabilityChanged(callback: (available: boolean) => void): vscode.Disposable {
    // Track whether the extension was previously installed to detect install vs uninstall
    let wasExtensionInstalled = isCopilotChatExtensionInstalled();

    const extensionListener = vscode.extensions.onDidChange(() => {
        const isNowInstalled = isCopilotChatExtensionInstalled();
        // Only retry if extension was just installed/enabled (not when uninstalled/disabled)
        const isEnablingScenario = isNowInstalled && !wasExtensionInstalled;
        wasExtensionInstalled = isNowInstalled;

        void checkAIFeaturesWithRetry(callback, isEnablingScenario);
    });

    const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('chat.disableAIFeatures')) {
            // Only retry when enabling (setting is now false/unchecked)
            const isEnablingScenario = !isAIFeaturesDisabledBySetting();
            void checkAIFeaturesWithRetry(callback, isEnablingScenario);
        }
    });

    return vscode.Disposable.from(extensionListener, configListener);
}
