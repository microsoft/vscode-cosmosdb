/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ext } from '../../extensionVariables';

const LLM_ASSETS_MANIFEST_KEY = 'llm.assets.manifest';
const INSTRUCTIONS_FILENAME = 'azurecosmosdb.instructions.md';
const EXPECTED_MD5 = 'A54B319AD86975EB072A681AFA9CB553';

/**
 * Cleans up the obsolete LLM instructions file that was previously deployed
 * to the VS Code prompts folder by older versions of this extension.
 *
 * - Deletes the file only if its MD5 hash matches the known unmodified hash
 * - Clears the obsolete manifest key from globalState
 *
 * This is idempotent and safe to call on every activation.
 */
export async function cleanupLLMInstructionsFiles(): Promise<void> {
    await callWithTelemetryAndErrorHandling('cosmosDB.llmInstructions.cleanup', async (context) => {
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.rethrow = false;

        // Remove the file if it exists and hasn't been modified
        const promptFolder = getPromptFolder();
        const filePath = path.join(promptFolder, INSTRUCTIONS_FILENAME);

        // Mask file paths from any error telemetry (fs errors often include paths)
        context.valuesToMask.push(promptFolder, filePath);
        const fileExists = fs.existsSync(filePath);
        context.telemetry.properties.fileFound = String(fileExists);

        if (fileExists) {
            const content = fs.readFileSync(filePath);
            const actualMd5 = crypto.createHash('md5').update(content).digest('hex').toUpperCase();
            const md5Matched = actualMd5 === EXPECTED_MD5;
            context.telemetry.properties.md5Matched = String(md5Matched);
            ext.outputChannel.info(`Found existing instructions file at ${filePath} with MD5 ${actualMd5}`);

            if (md5Matched) {
                fs.unlinkSync(filePath);
                context.telemetry.properties.fileDeleted = String(true);
                ext.outputChannel.info(`Deleted obsolete instructions file at ${filePath}`);
            }
        }

        // Clear the obsolete manifest from globalState
        await ext.context.globalState.update(LLM_ASSETS_MANIFEST_KEY, undefined);
    });
}

/**
 * Returns the VS Code user-level prompts folder, matching the path used
 * by the old deployLLMInstructionsFiles logic.
 */
function getPromptFolder(): string {
    const globalStorageUri = ext.context.globalStorageUri;
    const userFolder = path.dirname(globalStorageUri.fsPath);
    return path.join(userFolder, '..', 'prompts');
}
