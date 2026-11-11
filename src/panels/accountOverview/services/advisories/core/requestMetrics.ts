/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function summarizeRequestStatuses(counts: Readonly<Record<string, number>>) {
    let totalRequests = 0;
    let totalThrottled = 0;
    let totalErrors = 0;
    const errors = new Map<number, number>();
    for (const [rawStatus, count] of Object.entries(counts)) {
        const status = Number(rawStatus.trim());
        if (!/^\d+$/.test(rawStatus.trim()) || !Number.isSafeInteger(status) || !Number.isFinite(count) || count <= 0) {
            continue;
        }
        totalRequests += count;
        if (status === 429) {
            totalThrottled += count;
        } else if (status >= 400) {
            totalErrors += count;
            errors.set(status, (errors.get(status) ?? 0) + count);
        }
    }
    return { totalRequests, totalThrottled, totalErrors, errors };
}

export type OperationCategory = 'write' | 'read' | 'query' | 'execute' | 'other';

const OPERATION_CATEGORIES: Readonly<Record<string, OperationCategory>> = {
    create: 'write',
    upsert: 'write',
    replace: 'write',
    delete: 'write',
    patch: 'write',
    batch: 'write',
    executebatch: 'write',
    read: 'read',
    head: 'read',
    query: 'query',
    queryplan: 'query',
    readfeed: 'query',
    execute: 'execute',
    executejavascript: 'execute',
    executestoredprocedure: 'execute',
};

export function operationCategory(operation: string): OperationCategory {
    const key = operation.trim().toLowerCase();
    return Object.hasOwn(OPERATION_CATEGORIES, key) ? OPERATION_CATEGORIES[key] : 'other';
}
