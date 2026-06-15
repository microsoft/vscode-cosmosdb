/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PriorityLevel } from '@azure/cosmos';
import { type NoSqlQueryConnection } from './NoSqlQueryConnection';

/**
 * Resolve the Priority Level to send on a single data-plane Cosmos DB request.
 *
 * Rules (per the Priority Based Execution PRD, §3 and §6):
 * 1. An explicit user choice always wins — the Query Editor surfaces a picker
 *    when the account has `enablePriorityBasedExecution` set.
 * 2. Otherwise, when the connection is not Azure-backed (workspace-attached or
 *    connection-string accounts where ARM is unreachable), fall back to "Low"
 *    as a safe default. The service silently ignores the header on accounts
 *    that do not have priority-based execution enabled, but if it is enabled,
 *    our requests will be deprioritized first under load.
 * 3. For Azure-backed connections without an explicit choice, return
 *    `undefined` so the SDK omits the header — Cosmos DB then applies its
 *    server-side default (treated as High).
 *
 * **Caller responsibility:** only invoke this for data-plane operations on
 * `item`, `conflicts`, or `sproc(Execute)` resources. Do NOT attach the
 * resulting header to metadata calls such as `container.read()` or listings.
 */
export function resolveEffectivePriorityLevel(
    connection: Pick<NoSqlQueryConnection, 'azureMetadata'>,
    explicitChoice?: PriorityLevel,
): PriorityLevel | undefined {
    if (explicitChoice) {
        return explicitChoice;
    }
    return connection.azureMetadata ? undefined : ('Low' as PriorityLevel);
}
