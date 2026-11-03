/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Limits for the workload numbers entered in the Data-Modeling wizard.
 *
 * Two tiers are used. Warnings fire at real Azure Cosmos DB service limits, where a design would actually be
 * throttled or need a support request. Hard ceilings sit far beyond them and only catch typos or nonsense input,
 * so they never reject a legitimate large workload.
 *
 * Kept free of React so the wizard pages and the saved-state schema share the same rules.
 */

import * as l10n from '@vscode/l10n';
import { type ContainerModel } from './models';

/** Service limit: maximum provisioned throughput a single physical partition can serve. */
export const MAX_RU_PER_PHYSICAL_PARTITION = 10_000;
/** Service default: maximum throughput per container without an Azure support request. */
export const DEFAULT_MAX_RU_PER_CONTAINER = 1_000_000;
/** Sanity ceiling for a container's estimated throughput; well beyond any realistic workload. */
export const MAX_ESTIMATED_RU_PER_CONTAINER = 10_000_000;
/** Sanity ceiling for a single peak query or write rate field. */
export const MAX_OPERATIONS_PER_SEC = 1_000_000;
/** Sanity ceiling for the number of attributes in one document. */
export const MAX_ATTRIBUTE_COUNT = 10_000;
/** Sanity ceiling for the number of items in one array. */
export const MAX_ARRAY_ITEMS = 100_000;

/** Rough planning-only RU estimate for a point read: ~1 RU per KB. */
export function estimateReadRu(avgDocSizeKb: number): number {
    return Math.max(1, Math.round(avgDocSizeKb));
}

/** Rough planning-only RU estimate for a write: ~3 RU per KB. */
export function estimateWriteRu(avgDocSizeKb: number): number {
    return Math.max(2, Math.round(avgDocSizeKb * 3));
}

export type CountError = 'invalid' | 'negative' | 'fraction' | 'tooLarge';

/** Validate a user-entered count against `[0, max]`; counts must be whole numbers unless `allowFraction` is set. */
export function validateCount(value: number, max: number, allowFraction = false): CountError | undefined {
    if (!Number.isFinite(value)) {
        return 'invalid';
    }
    if (value < 0) {
        return 'negative';
    }
    if (!allowFraction && !Number.isInteger(value)) {
        return 'fraction';
    }
    return value > max ? 'tooLarge' : undefined;
}

export function getCountErrorMessage(error: CountError, max: number): string {
    switch (error) {
        case 'invalid':
            return l10n.t('Enter a number.');
        case 'negative':
            return l10n.t('Value cannot be negative.');
        case 'fraction':
            return l10n.t('Enter a whole number.');
        case 'tooLarge':
            return l10n.t('Value cannot exceed {max}.', { max: max.toLocaleString() });
    }
}

export function getArrayItemsOrderMessage(): string {
    return l10n.t('Average items per array cannot exceed maximum items per array.');
}

/** Parse a number input's raw text; an empty field counts as zero. */
export function parseCountInput(value: string): number {
    return value.trim() === '' ? 0 : Number(value);
}

export interface ContainerThroughputEstimate {
    readRuPerSec: number;
    writeRuPerSec: number;
    totalRuPerSec: number;
}

/** Estimated peak RU/s for a container, from its read query rates, write rates, and average document size. */
export function estimateContainerThroughput(
    container: Pick<ContainerModel, 'document' | 'reads' | 'writes'>,
): ContainerThroughputEstimate {
    const totalQps = container.reads.reduce((total, read) => total + read.qps, 0);
    const { insertsPerSec, updatesPerSec, deletesPerSec } = container.writes;
    const readRuPerSec = totalQps * estimateReadRu(container.document.avgSizeKb);
    const writeRuPerSec =
        (insertsPerSec + updatesPerSec + deletesPerSec) * estimateWriteRu(container.document.avgSizeKb);
    return { readRuPerSec, writeRuPerSec, totalRuPerSec: readRuPerSec + writeRuPerSec };
}

export type ThroughputIssueKind = 'unrealistic' | 'containerLimit' | 'hotPartition';

export interface ThroughputIssue {
    kind: ThroughputIssueKind;
    /** `error` blocks recommendation requests; `warning` is advisory only. */
    severity: 'error' | 'warning';
    ruPerSec: number;
}

/**
 * Assess a container's estimated throughput against the service limits. Concentrated writes ("skewed" or
 * "time-correlated") land on one physical partition, so their RU/s are compared with the per-partition limit.
 */
export function assessContainerThroughput(
    container: Pick<ContainerModel, 'document' | 'reads' | 'writes' | 'scale'>,
): ThroughputIssue[] {
    const estimate = estimateContainerThroughput(container);
    const issues: ThroughputIssue[] = [];
    if (estimate.totalRuPerSec > MAX_ESTIMATED_RU_PER_CONTAINER) {
        issues.push({ kind: 'unrealistic', severity: 'error', ruPerSec: estimate.totalRuPerSec });
    } else if (estimate.totalRuPerSec > DEFAULT_MAX_RU_PER_CONTAINER) {
        issues.push({ kind: 'containerLimit', severity: 'warning', ruPerSec: estimate.totalRuPerSec });
    }
    if (container.scale.writes !== 'even' && estimate.writeRuPerSec > MAX_RU_PER_PHYSICAL_PARTITION) {
        issues.push({ kind: 'hotPartition', severity: 'warning', ruPerSec: estimate.writeRuPerSec });
    }
    return issues;
}

export function getThroughputIssueMessage(issue: ThroughputIssue): string {
    const ru = Math.round(issue.ruPerSec).toLocaleString();
    switch (issue.kind) {
        case 'unrealistic':
            return l10n.t(
                'Estimated throughput of {ru} RU/s exceeds {max} RU/s and is not realistic for one container. Check the query and write rates.',
                { ru, max: MAX_ESTIMATED_RU_PER_CONTAINER.toLocaleString() },
            );
        case 'containerLimit':
            return l10n.t(
                'Estimated throughput of {ru} RU/s exceeds the default limit of {max} RU/s per container. Request a higher limit from Azure support, or split the workload across containers.',
                { ru, max: DEFAULT_MAX_RU_PER_CONTAINER.toLocaleString() },
            );
        case 'hotPartition':
            return l10n.t(
                'Writes are concentrated on a few partition key values. Their estimated {ru} RU/s exceeds the {max} RU/s one physical partition can serve, so requests will be throttled.',
                { ru, max: MAX_RU_PER_PHYSICAL_PARTITION.toLocaleString() },
            );
    }
}
