/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as crypto from 'crypto';
import * as fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { SettingsService } from '../../services/SettingsService';

export function deployLLMInstructionsFiles(_: IActionContext): void {
    const manageFiles = SettingsService.getSetting<boolean>('cosmosDB.manageLLMAssets') ?? true;
    if (!manageFiles) {
        // TODO: add telemetry
        console.log('Skipping deployLLMInstructionsFiles because manageLLMAssets is disabled');
        return;
    }

    const promptFolder = getPromptFolder();
    console.log('deployLLMInstructionsFiles to', promptFolder);

    const manifest: IDeploymentManifest = {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        extensionVersion: ext.context.extension.packageJSON.version as string,
        deploymentTimestamp: Date.now(),
        files: {},
    };

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
                // Calculate checksum
                const content = fs.readFileSync(destinationFile, 'utf8');
                const checksum = crypto.createHash('md5').update(content).digest('hex');

                // Add file to manifest
                manifest.files[file.name] = { checksum, status: 'deployed' };
            }
        }

        // Delete the files that were deployed previously that aren't part of the current deployment
        const previousManifest = JSON.parse(
            ext.context.globalState.get('llm.assets.manifest') || '{}',
        ) as IDeploymentManifest;
        for (const fileName in previousManifest.files) {
            if (!manifest.files[fileName]) {
                const filePath = path.join(promptFolder, fileName);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`Deleted ${filePath}`);
                }
            }
        }

        // Save manifest file to global storage
        ext.context.globalState.update('llm.assets.manifest', JSON.stringify(manifest, null, 2));
        console.log(`Saved manifest file to global storage`);

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
};

/**
 * The manifest records the last files deployment.
 * If files in the last deployment are not part of the current deployment, they will be deleted.
 * Keep track of the checksum of each file to determine if the file has been manually modified by the user after deployment.
 */
interface IDeploymentManifest {
    extensionVersion: string;
    deploymentTimestamp: number;
    files: {
        [fileName: string]: {
            checksum: string;
            status: 'deployed' | 'skipped';
        };
    };
}
