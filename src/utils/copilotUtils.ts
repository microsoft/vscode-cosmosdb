/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * GitHub Copilot extension IDs
 */
const COPILOT_EXTENSION_ID = 'github.copilot';
const COPILOT_CHAT_EXTENSION_ID = 'github.copilot-chat';

/**
 * Checks if the GitHub Copilot extension is installed and active.
 * @returns true if the Copilot extension is installed and active, false otherwise
 */
export function isCopilotExtensionInstalled(): boolean {
    const copilotExtension = vscode.extensions.getExtension(COPILOT_EXTENSION_ID);
    return copilotExtension !== undefined;
}

/**
 * Checks if the GitHub Copilot Chat extension is installed and active.
 * @returns true if the Copilot Chat extension is installed and active, false otherwise
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
 * Checks if all requirements for AI features are met:
 * 1. GitHub Copilot extension is installed
 * 2. GitHub Copilot Chat extension is installed (required for chat participant)
 * @returns true if all requirements are met, false otherwise
 */
export function areAIFeaturesEnabled(): boolean {
    return isCopilotExtensionInstalled() && isCopilotChatExtensionInstalled();
}

/**
 * Registers a listener for extension changes to detect when Copilot is installed/uninstalled.
 * @param callback Function to call when Copilot availability changes
 * @returns Disposable to unregister the listener
 */
export function onCopilotAvailabilityChanged(callback: (available: boolean) => void): vscode.Disposable {
    return vscode.extensions.onDidChange(() => {
        callback(areAIFeaturesEnabled());
    });
}
