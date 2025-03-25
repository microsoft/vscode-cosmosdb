/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-internal-modules
import { ManagedIdentityCredential } from '@azure/identity';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { AuthenticationMethod, type CosmosDBManagedIdentityCredential } from '../getCosmosClient';

let isRunningOnAzurePromise: Promise<boolean> | undefined = undefined;
let isRunningOnAzureResult: boolean | undefined = undefined;

/**
 * Determines if the current environment is running on Azure by checking for the
 * Azure Instance Metadata Service (IMDS).
 *
 * @returns {Promise<boolean>} True if running on Azure, false otherwise
 * @remarks
 * - Caches the result to avoid redundant network calls
 * - If called while a check is already in progress, waits for and returns that result
 * - Uses a 10-second timeout to prevent hanging in non-Azure environments
 * - The IMDS endpoint is only accessible from within Azure VMs or App Services
 */
export async function getIsRunningOnAzure(): Promise<boolean> {
    // Return cached result if available
    if (isRunningOnAzureResult !== undefined) {
        return isRunningOnAzureResult;
    }

    // If a check is already in progress, return that promise to avoid duplicate calls
    if (isRunningOnAzurePromise) {
        return isRunningOnAzurePromise;
    }

    // Create and cache the promise for concurrent callers
    isRunningOnAzurePromise = (async () => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch('http://169.254.169.254/metadata/versions', {
                headers: { Metadata: 'true' },
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                const data = (await response.json()) as { apiVersions?: string[] };
                if (Array.isArray(data?.apiVersions) && data.apiVersions.length > 0) {
                    ext.outputChannel.debug('Running on Azure: Instance Metadata Service detected');
                    return (isRunningOnAzureResult = true);
                }
            }
        } catch (error) {
            ext.outputChannel.debug(`Not running on Azure: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Default to false
        return (isRunningOnAzureResult = false);
    })();

    // Wait for and return the result
    const result = await isRunningOnAzurePromise;

    // Clear the promise reference after completion (only result is needed for future calls)
    isRunningOnAzurePromise = undefined;

    return result;
}

async function getHasManagedIdentity(
    accountEndpoint: string,
    clientId?: string,
    silent: boolean = true,
): Promise<boolean> {
    const cred = new ManagedIdentityCredential({ clientId: clientId });
    try {
        const endpointUrl = new URL(accountEndpoint);
        // Strip port from endpoint - just use protocol and hostname
        const endpointWithoutPort = `${endpointUrl.protocol}//${endpointUrl.hostname}`;
        await cred.getToken(`${endpointWithoutPort}/.default`);
        return true;
    } catch (error) {
        if (!silent) {
            ext.outputChannel.error(
                `Managed Identity token acquisition failed for account "${accountEndpoint}": ${error}`,
            );
        }
        return false;
    }
}

export async function getManagedIdentityAuth(
    accountEndpoint: string,
    force: boolean,
): Promise<CosmosDBManagedIdentityCredential | undefined> {
    // If not forcing and not on Azure, return early
    if (!force && !(await getIsRunningOnAzure())) {
        return undefined;
    }

    // Get client ID from settings
    const managedIdentityClientId = vscode.workspace
        .getConfiguration()
        .get<string>(ext.settingsKeys.authManagedIdentityClientId);

    // Check if credential works (skip check if forcing)
    // In the case of forcing, we will always try to use managed identity
    // which will likely fail if not on Azure with an auth error being logged.
    // This behaviour is expected as the user is forcing managed identity in settings.
    // In Automatic mode we want this to fail silently if not on Azure.
    if (force || (await getHasManagedIdentity(accountEndpoint, managedIdentityClientId, !force))) {
        return {
            type: AuthenticationMethod.managedIdentity,
            clientId: managedIdentityClientId,
        };
    }

    return undefined;
}
