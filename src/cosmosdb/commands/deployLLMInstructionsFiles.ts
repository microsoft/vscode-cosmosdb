/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';

export function deployLLMInstructionsFiles(_: IActionContext): void {
    const promptFolder = getPromptFolder();
    console.log('deployLLMInstructionsFiles to', promptFolder);

    try {
        // Create prompt folder if it doesn't exist
        if (!fs.existsSync(promptFolder)) {
            fs.mkdirSync(promptFolder, { recursive: true });
        }

        const dirname = __dirname;
        console.log('dirname', dirname);
        // Get the path to the source folder
        const sourceFolder = path.join(__dirname, 'resources', 'llm-instructions');

        // Check if source folder exists
        if (!fs.existsSync(sourceFolder)) {
            throw new Error(l10n.t('Source folder not found: {0}', sourceFolder));
        }

        // Read all files in the llm-instructions folder
        const files = fs.readdirSync(sourceFolder, { withFileTypes: true });
        const copiedFiles: string[] = [];

        for (const file of files) {
            if (file.isFile() && path.extname(file.name).toLowerCase() === '.md') {
                const sourceFile = path.join(sourceFolder, file.name);
                const destinationFile = path.join(promptFolder, file.name);

                // Copy each .md file
                fs.copyFileSync(sourceFile, destinationFile);
                copiedFiles.push(file.name);
                console.log(`Copied ${file.name} to ${destinationFile}`);
            }
        }

        // Show success dialog
        const message =
            copiedFiles.length > 0
                ? l10n.t('Successfully copied {0} LLM instructions (.md) files', copiedFiles.length)
                : l10n.t('No LLM instructions (.md) files found to copy');

        void vscode.window.showInformationMessage(message, l10n.t('Close'));
    } catch (error) {
        console.error('Error deploying AI instructions files:', error);

        // Show error dialog
        const errorMessage = error instanceof Error ? error.message : l10n.t('Unknown error occurred');
        void vscode.window.showErrorMessage(
            l10n.t('Failed to deploy LLM instruction files: {0}', errorMessage),
            l10n.t('Close'),
        );
    }
}

const getPromptFolder = () => {
    const globalStorageUri = ext.context.globalStorageUri;
    const userFolder = path.dirname(globalStorageUri.fsPath);
    const promptFolder = path.join(userFolder, '..', 'prompts');

    return promptFolder;
    // const platform = process.platform;
    // if (platform === 'win32') {
    //     return path.join(process.env.APPDATA!, 'Code', 'User');
    // } else if (platform === 'darwin') {
    //     return path.join(process.env.HOME!, 'Library', 'Application Support', 'Code', 'User');
    // } else {
    //     return path.join(process.env.HOME!, '.config', 'Code', 'User');
    // }
};
