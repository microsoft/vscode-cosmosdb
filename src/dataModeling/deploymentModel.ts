/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { z } from 'zod';
import { validateContainerName, validateDatabaseName } from '../cosmosdb/utils/validateResourceName';
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

export const GenerateDeploymentTemplateInputSchema = DeploymentTemplateInputSchema.extend({
    format: z.enum(['bicep', 'terraform', 'sdk']).optional(),
});

export type DatabaseMode = 'new' | 'existing';
export type DeploymentTemplateInput = z.infer<typeof DeploymentTemplateInputSchema>;
export type DeploymentRequest = z.infer<typeof DeploymentRequestSchema>;
export type GenerateDeploymentTemplateInput = z.infer<typeof GenerateDeploymentTemplateInputSchema>;
export type DeploymentTemplateFormat = NonNullable<GenerateDeploymentTemplateInput['format']>;
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

export const SuccessfulDeploymentSchema = z.object({
    input: DeploymentRequestSchema,
    result: z.object({
        status: z.literal('deployed'),
        databaseName: z.string().min(1).max(255),
        createdCount: z.number().int().nonnegative(),
        existingCount: z.number().int().nonnegative(),
    }),
});
export type SuccessfulDeployment = z.infer<typeof SuccessfulDeploymentSchema>;

/** Recommendations express hierarchical keys as comma-separated paths, not a single nested path. */
export function getPartitionKeyPaths(partitionKey: string): string[] {
    return partitionKey.split(',').map((path) => path.trim());
}

// The modeler validates exactly what the user typed; it never trims silently, so rejected names stay visible to fix.
export function validateDeploymentDatabaseName(name: string): string | undefined {
    if (name.trim() && name !== name.trim()) {
        return l10n.t('Database name cannot start or end with whitespace.');
    }
    const error = validateDatabaseName(name);
    if (error) return error;
    if (hasUnsafeDeploymentName(name)) {
        return l10n.t('Database name cannot contain control characters or "%", or be "." or "..".');
    }
    return undefined;
}

export function validateDeploymentContainerName(
    name: string,
    existingNames: readonly string[] = [],
): string | undefined {
    if (name.trim() && name !== name.trim()) {
        return l10n.t('Container name cannot start or end with whitespace.');
    }
    const error = validateContainerName(name);
    if (error) return error;
    if (hasUnsafeDeploymentName(name)) {
        return l10n.t('Container name cannot contain control characters or "%", or be "." or "..".');
    }
    if (existingNames.includes(name)) return l10n.t('A container with this name already exists in the model.');
    return undefined;
}

// Deployment names also become URL path segments in the provisioning and export pipelines.
function hasUnsafeDeploymentName(name: string): boolean {
    return (
        name.includes('%') ||
        name.split('').some((character) => character.charCodeAt(0) < 32) ||
        name === '.' ||
        name === '..'
    );
}
