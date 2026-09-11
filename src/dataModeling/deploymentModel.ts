/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { z } from 'zod';
import { MAX_CONTAINERS } from '../webviews/cosmosdb/DataModeling/models';

export const DeploymentContainersSchema = z
    .array(z.object({ entity: z.string(), partitionKey: z.string() }))
    .min(1)
    .max(MAX_CONTAINERS);

export type DeploymentContainer = z.infer<typeof DeploymentContainersSchema>[number];

export const DeploymentTemplateInputSchema = z.object({
    databaseMode: z.enum(['new', 'existing']),
    databaseName: z.string().min(1).max(255),
    containers: DeploymentContainersSchema,
});

export const DeploymentRequestSchema = DeploymentTemplateInputSchema.strict();

export type DatabaseMode = 'new' | 'existing';
export type DeploymentTemplateInput = z.infer<typeof DeploymentTemplateInputSchema>;
export type DeploymentRequest = z.infer<typeof DeploymentRequestSchema>;
export interface DeploymentOptions {
    accountName: string;
    subscriptionName?: string;
    resourceGroup?: string;
    databases: string[];
    unavailableReason?: string;
}

export type ModelDeploymentResult =
    | { status: 'cancelled' }
    | { status: 'deployed'; databaseName: string; createdCount: number; existingCount: number };

/** Recommendations express hierarchical keys as comma-separated paths, not a single nested path. */
export function getPartitionKeyPaths(partitionKey: string): string[] {
    return partitionKey.split(',').map((path) => path.trim());
}

export function validateDeploymentDatabaseName(name: string): string | undefined {
    if (!name.trim()) return l10n.t('Database name is required.');
    if (name !== name.trim()) return l10n.t('Database name cannot have surrounding whitespace.');
    if (name.length > 255) return l10n.t('Database name cannot be longer than 255 characters');
    if (
        /[/\\?#=%]/.test(name) ||
        name.split('').some((character) => character.charCodeAt(0) < 32) ||
        name === '.' ||
        name === '..'
    ) {
        return l10n.t(
            'Database name cannot contain path separators, control characters, "#", "?", "=", or "%", or be "." or "..".',
        );
    }
    return undefined;
}
