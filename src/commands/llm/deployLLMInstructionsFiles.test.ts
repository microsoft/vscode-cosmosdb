/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { deployLLMInstructionsFiles, removeLLMInstructionsFiles } from './deployLLMInstructionsFiles';

// Mock the callWithTelemetryAndErrorHandling function
jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(),
}));

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

jest.mock('@vscode/l10n', () => ({
    t: jest.fn(),
}));

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { SettingsService } from '../../services/SettingsService';

describe('LLM Instructions Files', () => {
    let mockTelemetryContext: IActionContext;

    // Helper function to create mock Dirent objects
    const createMockDirent = (name: string, isFile = true) => ({
        name,
        isFile: () => isFile,
        isDirectory: () => !isFile,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
    });

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup mock telemetry context that will be passed to the callback
        mockTelemetryContext = {
            telemetry: {
                properties: {},
                measurements: {},
            },
        } as IActionContext;

        // Mock the callWithTelemetryAndErrorHandling function
        (callWithTelemetryAndErrorHandling as jest.Mock).mockImplementation(
            (_eventName: string, callback: (context: IActionContext) => void) => {
                return callback(mockTelemetryContext);
            },
        );

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

        // Mock l10n
        (l10n.t as jest.Mock).mockImplementation((message: string, ...args: any[]) => {
            const templates: Record<string, string> = {
                'Source folder not found: {0}': `Source folder not found: ${args[0]}`,
                'Successfully copied {0} LLM instructions (.md) files': `Successfully copied ${args[0]} LLM instructions (.md) files`,
                'Successfully deleted {0} LLM instructions (.md) files': `Successfully deleted ${args[0]} LLM instructions (.md) files`,
                'No LLM instructions (.md) files found to copy': 'No LLM instructions (.md) files found to copy',
                'No LLM instructions (.md) files found to delete': 'No LLM instructions (.md) files found to delete',
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

    describe('deployLLMInstructionsFiles', () => {
        describe('when manageLLMAssets setting is disabled', () => {
            it('should skip deployment and return early', async () => {
                // Arrange
                (SettingsService.getSetting as jest.Mock).mockReturnValue(false);

                // Act
                await deployLLMInstructionsFiles({} as IActionContext);

                // Assert
                expect(console.log).toHaveBeenCalledWith(
                    'Skipping deployLLMInstructionsFiles because manageLLMAssets is disabled',
                );
                expect(fs.existsSync).not.toHaveBeenCalled();
                expect(mockTelemetryContext.telemetry.properties.skipped).toBe('true');
            });
        });

        describe('when manageLLMAssets setting is enabled', () => {
            it('should create prompt folder if it does not exist', async () => {
                // Arrange
                (SettingsService.getSetting as jest.Mock).mockReturnValue(true);
                (fs.existsSync as jest.Mock).mockImplementation((path: string) => {
                    return path !== 'C:\\Users\\test\\.vscode\\extensions\\..\\prompts';
                });

                // Act
                await deployLLMInstructionsFiles({} as IActionContext);

                // Assert
                expect(fs.mkdirSync).toHaveBeenCalledWith('C:\\Users\\test\\.vscode\\extensions\\..\\prompts', {
                    recursive: true,
                });
                expect(mockTelemetryContext.telemetry.properties.skipped).toBe('false');
            });

            it('should handle source folder not found error', async () => {
                // Arrange
                (SettingsService.getSetting as jest.Mock).mockReturnValue(true);
                (fs.existsSync as jest.Mock).mockImplementation((path: string) => {
                    return !path.toString().includes('llm-assets');
                });

                // Act
                await deployLLMInstructionsFiles({} as IActionContext);

                // Assert
                expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
                    expect.stringContaining('Failed to deploy LLM instruction files'),
                    'Close',
                );
                expect(mockTelemetryContext.telemetry.properties.skipped).toBe('false');
            });

            it('should copy new .md files', async () => {
                // Arrange
                (SettingsService.getSetting as jest.Mock).mockReturnValue(true);
                const mockFiles = [
                    createMockDirent('test1.md', true),
                    createMockDirent('test2.md', true),
                    createMockDirent('readme.txt', true), // Should be ignored
                    createMockDirent('subfolder', false), // Should be ignored
                ];
                (fs.readdirSync as jest.Mock).mockReturnValue(mockFiles);
                (fs.existsSync as jest.Mock).mockImplementation((path: string) => {
                    // Source folder exists, but destination files don't exist
                    return !path.includes('.md') || path.includes('llm-assets');
                });
                (fs.readFileSync as jest.Mock).mockReturnValue('file content');

                // Act
                await deployLLMInstructionsFiles({} as IActionContext);

                // Assert
                expect(fs.copyFileSync).toHaveBeenCalledTimes(2);
                expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
                    'Successfully copied 2 LLM instructions (.md) files',
                    'Close',
                );
                expect(vscode.window.createStatusBarItem).not.toHaveBeenCalled();
                expect(mockTelemetryContext.telemetry.properties.count).toBe('2');
            });

            it('should skip identical files and show status bar', async () => {
                // Arrange
                (SettingsService.getSetting as jest.Mock).mockReturnValue(true);
                const mockFiles = [createMockDirent('test1.md', true), createMockDirent('test2.md', true)];
                (fs.readdirSync as jest.Mock).mockReturnValue(mockFiles);
                (fs.existsSync as jest.Mock).mockReturnValue(true); // All files exist
                (fs.readFileSync as jest.Mock).mockReturnValue('identical content'); // Same content
                const mockStatusBar = {
                    text: '',
                    show: jest.fn(),
                    dispose: jest.fn(),
                };
                (vscode.window.createStatusBarItem as jest.Mock).mockReturnValue(mockStatusBar);

                // Act
                await deployLLMInstructionsFiles({} as IActionContext);

                // Assert
                expect(fs.copyFileSync).not.toHaveBeenCalled(); // No files copied because they're identical
                expect(console.log).toHaveBeenCalledWith('Skipped test1.md as it is unchanged');
                expect(console.log).toHaveBeenCalledWith('Skipped test2.md as it is unchanged');
                expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
                expect(vscode.window.createStatusBarItem).toHaveBeenCalled();
                expect(mockStatusBar.text).toBe('No LLM instructions (.md) files found to copy');
                expect(mockTelemetryContext.telemetry.properties.count).toBe('0');
            });

            it('should show status bar when no .md files found', async () => {
                // Arrange
                (SettingsService.getSetting as jest.Mock).mockReturnValue(true);
                const mockFiles = [createMockDirent('readme.txt', true), createMockDirent('subfolder', false)];
                (fs.readdirSync as jest.Mock).mockReturnValue(mockFiles);
                const mockStatusBar = {
                    text: '',
                    show: jest.fn(),
                    dispose: jest.fn(),
                };
                (vscode.window.createStatusBarItem as jest.Mock).mockReturnValue(mockStatusBar);

                // Act
                await deployLLMInstructionsFiles({} as IActionContext);

                // Assert
                expect(fs.copyFileSync).not.toHaveBeenCalled();
                expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
                expect(vscode.window.createStatusBarItem).toHaveBeenCalled();
                expect(mockStatusBar.text).toBe('No LLM instructions (.md) files found to copy');
                expect(mockStatusBar.show).toHaveBeenCalled();
                expect(mockTelemetryContext.telemetry.properties.count).toBe('0');
            });

            it('should handle errors gracefully', async () => {
                // Arrange
                (SettingsService.getSetting as jest.Mock).mockReturnValue(true);
                const error = new Error('Test error');
                (fs.readdirSync as jest.Mock).mockImplementation(() => {
                    throw error;
                });

                // Act
                await deployLLMInstructionsFiles({} as IActionContext);

                // Assert
                expect(console.error).toHaveBeenCalledWith('Error deploying AI instructions files:', error);
                expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
                    'Failed to deploy LLM instruction files: Test error',
                    'Close',
                );
            });

            it('should handle case-insensitive file extensions', async () => {
                // Arrange
                (SettingsService.getSetting as jest.Mock).mockReturnValue(true);
                const mockFiles = [
                    createMockDirent('test1.MD', true),
                    createMockDirent('test2.Md', true),
                    createMockDirent('test3.mD', true),
                ];
                (fs.readdirSync as jest.Mock).mockReturnValue(mockFiles);
                (fs.existsSync as jest.Mock).mockImplementation((path: string) => {
                    // Source folder exists, but destination files don't exist for uppercase variants
                    if (path.includes('llm-assets')) return true; // Source folder exists
                    if (path.includes('.MD') || path.includes('.Md') || path.includes('.mD')) return false; // Destination files don't exist
                    return true; // Other paths exist
                });
                (fs.readFileSync as jest.Mock).mockReturnValue('content');

                // Act
                await deployLLMInstructionsFiles({} as IActionContext);

                // Assert
                expect(fs.copyFileSync).toHaveBeenCalledTimes(3);
                expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
                    'Successfully copied 3 LLM instructions (.md) files',
                    'Close',
                );
                expect(vscode.window.createStatusBarItem).not.toHaveBeenCalled();
                expect(mockTelemetryContext.telemetry.properties.count).toBe('3');
            });

            it('should delete obsolete files from previous deployment', async () => {
                // Arrange
                (SettingsService.getSetting as jest.Mock).mockReturnValue(true);
                const previousManifest = {
                    files: {
                        'old-file.md': { status: 'deployed' },
                        'still-exists.md': { status: 'deployed' },
                    },
                };
                const mockFiles = [createMockDirent('still-exists.md', true), createMockDirent('new-file.md', true)];

                (ext.context.globalState.get as jest.Mock).mockReturnValue(JSON.stringify(previousManifest));
                (fs.readdirSync as jest.Mock).mockReturnValue(mockFiles);
                (fs.existsSync as jest.Mock).mockImplementation((path: string) => {
                    return !path.includes('new-file.md') || path.includes('llm-assets');
                });
                (fs.readFileSync as jest.Mock).mockReturnValue('file content');

                // Act
                await deployLLMInstructionsFiles({} as IActionContext);

                // Assert
                expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('old-file.md'));
                expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Deleted obsolete'));
            });
        });
    });

    describe('removeLLMInstructionsFiles', () => {
        it('should remove all files listed in manifest', async () => {
            // Arrange
            const manifest = {
                files: {
                    'file1.md': { status: 'deployed' },
                    'file2.md': { status: 'deployed' },
                    'file3.md': { status: 'deployed' },
                },
            };
            (ext.context.globalState.get as jest.Mock).mockReturnValue(JSON.stringify(manifest));
            (fs.existsSync as jest.Mock).mockReturnValue(true);

            // Act
            await removeLLMInstructionsFiles({} as IActionContext);

            // Assert
            expect(fs.unlinkSync).toHaveBeenCalledTimes(3);
            expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('file1.md'));
            expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('file2.md'));
            expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('file3.md'));
            // eslint-disable-next-line @typescript-eslint/unbound-method
            expect(ext.context.globalState.update).toHaveBeenCalledWith('llm.assets.manifest', undefined);
            expect(mockTelemetryContext.telemetry.properties.count).toBe('3');
            expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
                'Successfully deleted 3 LLM instructions (.md) files',
                'Close',
            );
        });

        it('should handle files that do not exist on disk', async () => {
            // Arrange
            const manifest = {
                files: {
                    'nonexistent.md': { status: 'deployed' },
                    'existing.md': { status: 'deployed' },
                },
            };
            (ext.context.globalState.get as jest.Mock).mockReturnValue(JSON.stringify(manifest));
            (fs.existsSync as jest.Mock).mockImplementation((path: string) => {
                return path.includes('existing.md');
            });

            // Act
            await removeLLMInstructionsFiles({} as IActionContext);

            // Assert
            expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
            expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('existing.md'));
            expect(mockTelemetryContext.telemetry.properties.count).toBe('1');
        });

        it('should show message when no files found to delete', async () => {
            // Arrange
            (ext.context.globalState.get as jest.Mock).mockReturnValue('{}');

            // Act
            await removeLLMInstructionsFiles({} as IActionContext);

            // Assert
            expect(fs.unlinkSync).not.toHaveBeenCalled();
            expect(mockTelemetryContext.telemetry.properties.count).toBe('0');
            expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
                'No LLM instructions (.md) files found to delete',
                'Close',
            );
        });
    });
});
