/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { areAIFeaturesEnabled, isCopilotChatExtensionInstalled, isCopilotExtensionInstalled } from './copilotUtils';

// Mock the vscode module
jest.mock('vscode', () => ({
    extensions: {
        getExtension: jest.fn(),
        onDidChange: jest.fn(),
    },
    lm: {
        selectChatModels: jest.fn(),
    },
}));

describe('copilotUtils', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('isCopilotExtensionInstalled', () => {
        it('returns true when GitHub Copilot extension is installed', () => {
            const mockExtension = { id: 'github.copilot' };
            (vscode.extensions.getExtension as jest.Mock).mockReturnValue(mockExtension);

            expect(isCopilotExtensionInstalled()).toBe(true);
            expect(vscode.extensions.getExtension).toHaveBeenCalledWith('github.copilot');
        });

        it('returns false when GitHub Copilot extension is not installed', () => {
            (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);

            expect(isCopilotExtensionInstalled()).toBe(false);
            expect(vscode.extensions.getExtension).toHaveBeenCalledWith('github.copilot');
        });
    });

    describe('isCopilotChatExtensionInstalled', () => {
        it('returns true when GitHub Copilot Chat extension is installed', () => {
            const mockExtension = { id: 'github.copilot-chat' };
            (vscode.extensions.getExtension as jest.Mock).mockReturnValue(mockExtension);

            expect(isCopilotChatExtensionInstalled()).toBe(true);
            expect(vscode.extensions.getExtension).toHaveBeenCalledWith('github.copilot-chat');
        });

        it('returns false when GitHub Copilot Chat extension is not installed', () => {
            (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);

            expect(isCopilotChatExtensionInstalled()).toBe(false);
            expect(vscode.extensions.getExtension).toHaveBeenCalledWith('github.copilot-chat');
        });
    });

    describe('areAIFeaturesEnabled', () => {
        it('returns true when both Copilot and Copilot Chat extensions are installed', () => {
            (vscode.extensions.getExtension as jest.Mock).mockImplementation((id: string) => {
                if (id === 'github.copilot' || id === 'github.copilot-chat') {
                    return { id };
                }
                return undefined;
            });

            expect(areAIFeaturesEnabled()).toBe(true);
        });

        it('returns false when only Copilot extension is installed', () => {
            (vscode.extensions.getExtension as jest.Mock).mockImplementation((id: string) => {
                if (id === 'github.copilot') {
                    return { id };
                }
                return undefined;
            });

            expect(areAIFeaturesEnabled()).toBe(false);
        });

        it('returns false when only Copilot Chat extension is installed', () => {
            (vscode.extensions.getExtension as jest.Mock).mockImplementation((id: string) => {
                if (id === 'github.copilot-chat') {
                    return { id };
                }
                return undefined;
            });

            expect(areAIFeaturesEnabled()).toBe(false);
        });

        it('returns false when neither extension is installed', () => {
            (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);

            expect(areAIFeaturesEnabled()).toBe(false);
        });
    });
});
