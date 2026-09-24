/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type DerivedAdvisoryRule } from '../../api/types';

/**
 * Detector-level display copy for a rule: the group card shows this name + description once per detector, no matter
 * how many containers fired it. The per-container specifics (which container, the exact numbers, the suggested fix)
 * stay on each advisory and are shown in the drill-in dialog. Keeping this map in the webview avoids a
 * server round-trip for static presentation strings while the detectors keep owning the per-container rationale.
 */
export function ruleMeta(rule: DerivedAdvisoryRule): { name: string; description: string } {
    switch (rule) {
        case 'HotPartitionRisk':
            return {
                name: l10n.t('Hot partitions'),
                description: l10n.t(
                    'One physical partition is saturated while its siblings sit idle. Traffic is skewed toward a single partition-key range.',
                ),
            };
        case 'SustainedThrottlingInRegion':
            return {
                name: l10n.t('Sustained throttling'),
                description: l10n.t(
                    'Every physical partition is at capacity, so the container is uniformly under-provisioned and throttling requests.',
                ),
            };
        case 'OverProvisioning':
            return {
                name: l10n.t('Over-provisioned throughput'),
                description: l10n.t(
                    'Provisioned RU/s stays well above observed demand, so you are paying for capacity the workload never uses.',
                ),
            };
        case 'AutoscaleCandidate':
            return {
                name: l10n.t('Autoscale candidates'),
                description: l10n.t(
                    'Bursty workloads that sit idle between spikes would usually cost less on autoscale than on fixed manual throughput.',
                ),
            };
        case 'StorageGrowthRisk':
            return {
                name: l10n.t('Storage growth risk'),
                description: l10n.t(
                    'A physical partition is on track to reach the 50 GiB split ceiling soon at its current storage growth rate.',
                ),
            };
        case 'StorageSkewRisk':
            return {
                name: l10n.t('Storage skew'),
                description: l10n.t(
                    'One physical partition holds far more data than its siblings and will hit the split ceiling long before them.',
                ),
            };
        case 'IndexingCostRisk':
            return {
                name: l10n.t('Indexing cost risk'),
                description: l10n.t(
                    'Index storage is large relative to data, suggesting the indexing policy covers more than the workload actually queries.',
                ),
            };
        case 'ExpensiveConsistency':
            return {
                name: l10n.t('Expensive consistency'),
                description: l10n.t(
                    'A strong or bounded-staleness consistency level multiplies read RU cost. Relax it where the workload allows.',
                ),
            };
        case 'MultiRegionWriteAntipattern':
            return {
                name: l10n.t('Multi-region write antipattern'),
                description: l10n.t(
                    'Multi-region writes are enabled without a conflict-resolution setup that fits the workload, risking write conflicts.',
                ),
            };
        case 'IdleContainer':
            return {
                name: l10n.t('Idle containers'),
                description: l10n.t(
                    'Containers are provisioned but serve almost no traffic. Their entire reservation is round-the-clock waste.',
                ),
            };
        case 'PartitionMergeCandidate':
            return {
                name: l10n.t('Partition merge candidates'),
                description: l10n.t(
                    'Containers have more physical partitions than their RU/s and storage need, adding avoidable per-partition overhead.',
                ),
            };
        case 'AutoscaleMaxOverProvisioned':
            return {
                name: l10n.t('Autoscale max set too high'),
                description: l10n.t(
                    'Autoscale containers rarely approach their configured maximum, so the max can be lowered to cap cost safely.',
                ),
            };
        case 'AutoscaleToManualCandidate':
            return {
                name: l10n.t('Autoscale to manual candidates'),
                description: l10n.t(
                    'Autoscale containers running at a steady load would usually be cheaper on fixed manual throughput.',
                ),
            };
        case 'ServerlessCandidate':
            return {
                name: l10n.t('Serverless candidates'),
                description: l10n.t(
                    'The account consumption pattern is intermittent enough that serverless may cost less than provisioned throughput.',
                ),
            };
        case 'CrossPartitionQuery':
            return {
                name: l10n.t('Cross-partition queries'),
                description: l10n.t(
                    'A large share of queries fan out across every physical partition, multiplying their RU cost.',
                ),
            };
        case 'ShardKeyMisalignment':
            return {
                name: l10n.t('Partition key misalignment'),
                description: l10n.t(
                    'Queries filter on a field other than the partition key, so they cannot target a single partition.',
                ),
            };
        case 'UncontrolledIngestion':
            return {
                name: l10n.t('Uncontrolled ingestion'),
                description: l10n.t(
                    'Write-dominant bursts drive throttling, indicating ingestion is not paced against provisioned throughput.',
                ),
            };
        case 'SharedThroughputStarvation':
            return {
                name: l10n.t('Shared-throughput starvation'),
                description: l10n.t(
                    'Containers in a shared-throughput database compete for one RU pool and starve each other under load.',
                ),
            };
    }
}
