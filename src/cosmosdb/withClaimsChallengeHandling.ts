/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ErrorResponse, type CosmosClient } from '@azure/cosmos';
import * as l10n from '@vscode/l10n';
import { ext } from '../extensionVariables';
import { type AccountInfo } from '../tree/cosmosdb/AccountInfo';
import { type CosmosDBCredential } from './CosmosDBCredential';
import { getCosmosClient, type GetCosmosClientOptions } from './getCosmosClient';
import { isNoSqlQueryConnection, type NoSqlQueryConnection } from './NoSqlQueryConnection';

const MAX_RETRY_ATTEMPTS = 1; // Maximum retry attempts for claims challenge handling

/**
 * Async generator for handling retries with event loop breaks
 */
async function* retryGenerator<T>(
    endpoint: string,
    credentials: CosmosDBCredential[],
    isEmulator: boolean,
    callback: (client: CosmosClient) => Promise<T>,
    options?: GetCosmosClientOptions,
    maxAttempts: number = MAX_RETRY_ATTEMPTS,
): AsyncGenerator<undefined, T, undefined> {
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            // Using a simple yield on retry iterations ensures we break the call stack
            // This prevents MAX_CALL_STACK_SIZE_EXCEEDED errors without needing setImmediate
            if (attempt > 0) {
                yield; // Generator suspension naturally breaks the call stack
                ext.outputChannel.debug(l10n.t('Retry attempt {0}', attempt + 1));
            }

            const client = getCosmosClient(endpoint, credentials, isEmulator, options);
            return await callback(client);
        } catch (error) {
            lastError = error;

            // Check for claims challenge
            if (isErrorResponse(error) && isClaimsChallenge(error)) {
                ext.outputChannel.info(
                    l10n.t('Received claims challenge on attempt {0}. Updating authentication...', attempt + 1),
                );

                // Extract claims and update options for next attempt
                const challenges = extractChallenges(error);
                options = {
                    ...options,
                    wwwAuthenticate: challenges.join(', '),
                };

                // Continue to next iteration with updated options
                // Each iteration naturally breaks the call stack through the generator mechanism
                continue;
            }

            // Not a claims challenge, rethrow immediately
            throw error;
        }
    }

    // If we've exhausted all attempts
    throw lastError;
}

/**
 * Some Cosmos DB write/update/delete operations may return a 401 Unauthorized error
 * since the token used to authenticate the request is not having the required claims.
 * This function handles such cases by retrying the operation with updated authentication.
 */
export async function withClaimsChallengeHandling<T>(
    connection: NoSqlQueryConnection,
    callback: (client: CosmosClient) => Promise<T>,
    options?: GetCosmosClientOptions,
): Promise<T>;
export async function withClaimsChallengeHandling<T>(
    accountInfo: AccountInfo,
    callback: (client: CosmosClient) => Promise<T>,
    options?: GetCosmosClientOptions,
): Promise<T>;
export async function withClaimsChallengeHandling<T>(
    endpoint: string,
    credentials: CosmosDBCredential[],
    isEmulator: boolean,
    callback: (client: CosmosClient) => Promise<T>,
    options?: GetCosmosClientOptions,
): Promise<T>;
export async function withClaimsChallengeHandling<T>(
    arg1: NoSqlQueryConnection | AccountInfo | string,
    arg2: ((client: CosmosClient) => Promise<T>) | CosmosDBCredential[],
    arg3?: GetCosmosClientOptions | boolean,
    arg4?: (client: CosmosClient) => Promise<T>,
    arg5?: GetCosmosClientOptions,
): Promise<T> {
    // Normalize input parameters
    let endpoint: string;
    let credentials: CosmosDBCredential[];
    let isEmulator: boolean;
    let callback: (client: CosmosClient) => Promise<T>;
    let options: GetCosmosClientOptions | undefined;

    if (typeof arg1 === 'string') {
        // Handle direct parameters
        endpoint = arg1;
        credentials = arg2 as CosmosDBCredential[];
        isEmulator = arg3 as boolean;
        callback = arg4 as (client: CosmosClient) => Promise<T>;
        options = arg5;
    } else if (isNoSqlQueryConnection(arg1)) {
        // Handle NoSqlQueryConnection
        endpoint = arg1.endpoint;
        credentials = arg1.credentials;
        isEmulator = arg1.isEmulator;
        callback = arg2 as (client: CosmosClient) => Promise<T>;
        options = arg3 as GetCosmosClientOptions;
    } else {
        // Handle AccountInfo
        const accountInfo = arg1 as AccountInfo;
        endpoint = accountInfo.endpoint;
        credentials = accountInfo.credentials || [];
        isEmulator = accountInfo.isEmulator || false;
        callback = arg2 as (client: CosmosClient) => Promise<T>;
        options = arg3 as GetCosmosClientOptions;
    }

    // Use the async generator to handle retries with event loop breaks
    const generator = retryGenerator(endpoint, credentials, isEmulator, callback, options);

    // Consume the generator to its final value
    // Yealding means we got a challenge and are retrying
    // Otherwise, we return the final value or throw an error
    let result: IteratorResult<undefined, T>;
    do {
        result = await generator.next();
    } while (!result.done);

    return result.value;
}

function isErrorResponse(error: unknown): error is ErrorResponse {
    return !!(
        error instanceof ErrorResponse ||
        (error && typeof error === 'object' && 'code' in error && 'headers' in error)
    );
}

/**
 * Check if error is a claims challenge (401 with WWW-Authenticate)
 */
function isClaimsChallenge(error: ErrorResponse): boolean {
    return (error?.code === 401 || error?.code === '401') && extractChallenges(error).length > 0;
}

/**
 * Extract WWW-Authenticate headers from error
 */
function extractChallenges(error: ErrorResponse): string[] {
    const challenges: string[] = [];

    // Try to extract from various error object structures
    const headers = error?.headers || {};
    Object.entries(headers).forEach(([key, value]) => {
        if (key.toLowerCase() === 'www-authenticate') {
            if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
                challenges.push(...value);
            } else if (typeof value === 'string') {
                challenges.push(value);
            }
        }
    });

    return challenges;
}
