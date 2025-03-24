/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-internal-modules
import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { AuthenticationMethod, type CosmosDBManagedIdentityCredential } from '../getCosmosClient';

// Module-level variable to cache the result of running on Azure check
let isRunningOnAzure: boolean | undefined = undefined;

/**
 * Determines if the current environment is running on Azure by checking for the
 * Azure Instance Metadata Service (IMDS).
 *
 * @returns {Promise<boolean>} True if running on Azure, false otherwise
 * @remarks
 * - Caches the result in module-level variable to avoid repeated network calls
 * - Uses a 2-second timeout to prevent hanging in non-Azure environments
 * - The IMDS endpoint is only accessible from within Azure VMs or App Services
 * - Learn more: https://aka.ms/azureimds
 */
export async function getIsRunningOnAzure(): Promise<boolean> {
    // Return cached result if available to avoid redundant checks
    if (isRunningOnAzure !== undefined) {
        return isRunningOnAzure;
    }
    isRunningOnAzure = false; // Default to false until proven otherwise

    try {
        // Create an AbortController to implement request timeout
        // This prevents the request from hanging indefinitely in non-Azure environments
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 second timeout

        // Contact the Azure Instance Metadata Service endpoint
        // The 'Metadata: true' header is required by the IMDS protocol
        // https://aka.ms/azureimds#versions
        const response = await fetch('http://169.254.169.254/metadata/versions', {
            headers: { Metadata: 'true' },
            signal: controller.signal,
        });

        clearTimeout(timeoutId); // Clean up timeout to prevent memory leaks

        // Validate that the response contains the expected IMDS structure
        // A valid response should contain an array of supported API versions
        if (response.ok) {
            const data = (await response.json()) as { apiVersions?: string[] };
            if (Array.isArray(data?.apiVersions) && data.apiVersions.length > 0) {
                ext.outputChannel.debug('Running on Azure: Instance Metadata Service detected');
                return (isRunningOnAzure = true); // Cache and return result
            }
        }
    } catch (error) {
        // This will catch network errors, timeouts, and JSON parsing failures
        ext.outputChannel.debug(`Not running on Azure: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Default case: not on Azure or IMDS check failed
    return (isRunningOnAzure = false); // Cache and return result
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

export async function getHasAzureCliCredential(accountEndpoint: string, tenantId?: string): Promise<boolean> {
    const cred = new AzureCliCredential({ tenantId: tenantId, processTimeoutInMs: 10000 });
    try {
        const endpointUrl = new URL(accountEndpoint);
        // Strip port from endpoint - just use protocol and hostname
        const endpointWithoutPort = `${endpointUrl.protocol}//${endpointUrl.hostname}`;
        await cred.getToken(`${endpointWithoutPort}/.default`);
        return true;
    } catch (error) {
        ext.outputChannel.appendLine(`Managed Identity token acquisition failed: ${error}`);
        return false;
    }
}
