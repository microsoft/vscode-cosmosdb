/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ReportPartitionKeyRecommendationInput } from '../chat/reportPartitionKeyRecommendationTool';

const pending = new Map<string, (outcome: ReportPartitionKeyRecommendationInput) => void>();
const ended = new Set<string>();

function markEnded(requestId: string): void {
    pending.delete(requestId);
    ended.add(requestId);
    if (ended.size > 256) ended.delete(ended.values().next().value!);
}

/** Ephemeral validation destinations are separate from real wizard tabs and persisted projects. */
export function registerRecommendationValidationRequest(
    requestId: string,
    receive: (outcome: ReportPartitionKeyRecommendationInput) => void,
): { dispose(): void } {
    if (pending.has(requestId) || ended.has(requestId)) throw new Error('Duplicate validation request ID.');
    pending.set(requestId, receive);
    return {
        dispose() {
            markEnded(requestId);
        },
    };
}

export function isRecommendationValidationRequest(requestId: string): boolean {
    return pending.has(requestId) || ended.has(requestId);
}

/** Return true for both delivered and expired validation IDs so neither can fall through to a real wizard. */
export function deliverRecommendationValidationResult(outcome: ReportPartitionKeyRecommendationInput): boolean {
    const receive = pending.get(outcome.wizardTabId);
    if (receive) {
        markEnded(outcome.wizardTabId);
        receive(outcome);
        return true;
    }
    return ended.has(outcome.wizardTabId);
}
