/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { deployLLMInstructionsFiles } from './deployLLMInstructionsFiles';

// Mock all dependencies
jest.mock('../../extensionVariables', () => ({
    ext: {
        context: {
            globalStorageUri: {
                fsPath: 'C:\\Users\\test\\.vscode\\extensions\\storage',
            },
            extension: {
                packageJSON: {
                    version: '1.0.0',
                },
            },
            globalState: {
                get: jest.fn().mockReturnValue('{}'),
                update: jest.fn(),
            },
        },
    },
}));

jest.mock('../../services/SettingsService', () => ({
    SettingsService: {
        getSetting: jest.fn(),
    },
}));

jest.mock('fs', () => ({
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    readdirSync: jest.fn(),
    copyFileSync: jest.fn(),
    readFileSync: jest.fn(),
    unlinkSync: jest.fn(),
}));

jest.mock('path', () => ({
    dirname: jest.fn(),
    join: jest.fn(),
    extname: jest.fn(),
}));

jest.mock('crypto', () => ({
    createHash: jest.fn(),
}));

jest.mock('@vscode/l10n', () => ({
    t: jest.fn(),
}));

import * as l10n from '@vscode/l10n';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { SettingsService } from '../../services/SettingsService';

describe('deployLLMInstructionsFiles', () => {
    const mockActionContext: IActionContext = {
        telemetry: {
            properties: {},
            measurements: {},
        },
    } as IActionContext;

    beforeEach(() => {
        jest.clearAllMocks();

        // Reset telemetry data
        mockActionContext.telemetry.properties = {};
        mockActionContext.telemetry.measurements = {};

        // Mock fs functions
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.mkdirSync as jest.Mock).mockImplementation();
        (fs.readdirSync as jest.Mock).mockReturnValue([]);
        (fs.copyFileSync as jest.Mock).mockImplementation();
        (fs.readFileSync as jest.Mock).mockReturnValue('test content');
        (fs.unlinkSync as jest.Mock).mockImplementation();

        // Mock path functions
        (path.dirname as jest.Mock).mockImplementation((p: string) => {
            if (p === 'C:\\Users\\test\\.vscode\\extensions\\storage') {
                return 'C:\\Users\\test\\.vscode\\extensions';
            }
            return p;
        });
        (path.join as jest.Mock).mockImplementation((...paths: string[]) => paths.join('\\'));
        (path.extname as jest.Mock).mockImplementation((p: string) => {
            const lastDot = p.lastIndexOf('.');
            return lastDot >= 0 ? p.substring(lastDot) : '';
        });

        // Mock crypto
        const mockHashMethods = {
            update: jest.fn().mockReturnThis(),
            digest: jest.fn().mockReturnValue('mockhash123'),
        };
        (crypto.createHash as jest.Mock).mockReturnValue(mockHashMethods);

        // Mock l10n
        (l10n.t as jest.Mock).mockImplementation((message: string, ...args: any[]) => {
            const templates: Record<string, string> = {
                'Source folder not found: {0}': `Source folder not found: ${args[0]}`,
                'Successfully copied {0} LLM instructions (.md) files': `Successfully copied ${args[0]} LLM instructions (.md) files`,
                'No LLM instructions (.md) files found to copy': 'No LLM instructions (.md) files found to copy',
                'Failed to deploy LLM instruction files: {0}': `Failed to deploy LLM instruction files: ${args[0]}`,
                'Unknown error occurred': 'Unknown error occurred',
                Close: 'Close',
            };
            return templates[message] || message;
        });

        // Setup console mocks
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('when manageLLMAssets setting is disabled', () => {
        it('should skip deployment and return early', () => {
            // Arrange
            (SettingsService.getSetting as jest.Mock).mockReturnValue(false);

            // Act
            deployLLMInstructionsFiles(mockActionContext);

            // Assert
            expect(console.log).toHaveBeenCalledWith(
                'Skipping deployLLMInstructionsFiles because manageLLMAssets is disabled',
            );
            expect(fs.existsSync).not.toHaveBeenCalled();
        });
    });

    describe('when manageLLMAssets setting is enabled', () => {
        beforeEach(() => {
            (SettingsService.getSetting as jest.Mock).mockReturnValue(true);
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readdirSync as jest.Mock).mockReturnValue([]);
        });

        it('should create prompt folder if it does not exist', () => {
            // Arrange
            (fs.existsSync as jest.Mock).mockImplementation((path: string) => {
                return path !== 'C:\\Users\\test\\.vscode\\extensions\\..\\prompts';
            });

            // Act
            deployLLMInstructionsFiles(mockActionContext);

            // Assert
            expect(fs.mkdirSync).toHaveBeenCalledWith('C:\\Users\\test\\.vscode\\extensions\\..\\prompts', {
                recursive: true,
            });
        });

        it('should handle source folder not found error', () => {
            // Arrange
            (fs.existsSync as jest.Mock).mockImplementation((path: string) => {
                return !path.toString().includes('llm-assets');
            });

            // Act
            deployLLMInstructionsFiles(mockActionContext);

            // Assert
            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
                expect.stringContaining('Failed to deploy LLM instruction files'),
                'Close',
            );
        });

        it('should copy .md files and create manifest', () => {
            // Arrange
            const mockFiles = [
                { name: 'test1.md', isFile: () => true },
                { name: 'test2.md', isFile: () => true },
                { name: 'readme.txt', isFile: () => true }, // Should be ignored
                { name: 'subfolder', isFile: () => false }, // Should be ignored
            ];
            (fs.readdirSync as jest.Mock).mockReturnValue(mockFiles);
            (fs.readFileSync as jest.Mock).mockReturnValue('file content');

            // Act
            deployLLMInstructionsFiles(mockActionContext);

            // Assert
            expect(fs.copyFileSync).toHaveBeenCalledTimes(2);
            expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
                'Successfully copied 2 LLM instructions (.md) files',
                'Close',
            );
        });

        it('should show message when no .md files found', () => {
            // Arrange
            const mockFiles = [
                { name: 'readme.txt', isFile: () => true },
                { name: 'subfolder', isFile: () => false },
            ];
            (fs.readdirSync as jest.Mock).mockReturnValue(mockFiles);

            // Act
            deployLLMInstructionsFiles(mockActionContext);

            // Assert
            expect(fs.copyFileSync).not.toHaveBeenCalled();
            expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
                'No LLM instructions (.md) files found to copy',
                'Close',
            );
        });

        it('should handle errors gracefully', () => {
            // Arrange
            const error = new Error('Test error');
            (fs.readdirSync as jest.Mock).mockImplementation(() => {
                throw error;
            });

            // Act
            deployLLMInstructionsFiles(mockActionContext);

            // Assert
            expect(console.error).toHaveBeenCalledWith('Error deploying AI instructions files:', error);
            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
                'Failed to deploy LLM instruction files: Test error',
                'Close',
            );
        });

        it('should handle case-insensitive file extensions', () => {
            // Arrange
            const mockFiles = [
                { name: 'test1.MD', isFile: () => true },
                { name: 'test2.Md', isFile: () => true },
                { name: 'test3.mD', isFile: () => true },
            ];
            (fs.readdirSync as jest.Mock).mockReturnValue(mockFiles);
            (fs.readFileSync as jest.Mock).mockReturnValue('content');

            // Act
            deployLLMInstructionsFiles(mockActionContext);

            // Assert
            expect(fs.copyFileSync).toHaveBeenCalledTimes(3);
            expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
                'Successfully copied 3 LLM instructions (.md) files',
                'Close',
            );
        });

        it('should delete files from previous deployment', () => {
            // Arrange
            const previousManifest = {
                files: {
                    'old-file.md': { checksum: 'hash1', status: 'deployed' },
                    'still-exists.md': { checksum: 'hash2', status: 'deployed' },
                },
            };
            const mockFiles = [
                { name: 'still-exists.md', isFile: () => true },
                { name: 'new-file.md', isFile: () => true },
            ];

            (ext.context.globalState.get as jest.Mock).mockReturnValue(JSON.stringify(previousManifest));
            (fs.readdirSync as jest.Mock).mockReturnValue(mockFiles);
            (fs.readFileSync as jest.Mock).mockReturnValue('file content');

            // Act
            deployLLMInstructionsFiles(mockActionContext);

            // Assert
            expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('old-file.md'));
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Deleted'));
        });
    });
});
