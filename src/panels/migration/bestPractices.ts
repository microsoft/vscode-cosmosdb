/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { ext } from '../../extensionVariables';

/**
 * Returns Cosmos DB best practices content from the embedded skill file
 * (`skills/cosmosdb-best-practices/SKILL.md`). The content is lazily read
 * from disk on first access and cached for the lifetime of the extension.
 */
let cachedBestPractices: string | undefined;

export function getCosmosDbBestPractices(): string {
    if (cachedBestPractices === undefined) {
        try {
            cachedBestPractices = fs.readFileSync(
                path.join(ext.context.extensionPath, 'skills', 'cosmosdb-best-practices', 'SKILL.md'),
                'utf-8',
            );
        } catch (error) {
            console.warn('Failed to load Cosmos DB best practices skill:', error);
            cachedBestPractices = '';
        }
    }
    return cachedBestPractices;
}
