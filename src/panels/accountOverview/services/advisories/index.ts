/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Barrel for the derived-advisory engine, split into core types/helpers, per-rule detectors, the engine +
// registry that runs them, the server-side collector, and the Tier-1/Tier-2 data-fetch seams. This is the
// public surface the zone router, the webview type re-exports, and the unit tests consume.

export * from './core/types';
export * from './core/thresholds';
export * from './core/helpers';
export * from './core/Detector';
export * from './engine';
export * from './registry';
export * from './collect';

export * from './detectors/storageMath';
export * from './detectors/HotPartitionRiskDetector';
export * from './detectors/UnderProvisioningDetector';
export * from './detectors/OverProvisioningDetector';
export * from './detectors/AutoscaleCandidateDetector';
export * from './detectors/StorageGrowthRiskDetector';
export * from './detectors/StorageSkewRiskDetector';
export * from './detectors/IndexingCostRiskDetector';
export * from './detectors/ExpensiveConsistencyDetector';
export * from './detectors/MultiRegionWriteAntipatternDetector';
export * from './detectors/IdleContainerDetector';
export * from './detectors/PartitionMergeCandidateDetector';
export * from './detectors/AutoscaleMaxOverProvisionedDetector';
export * from './detectors/AutoscaleToManualCandidateDetector';
export * from './detectors/ServerlessCandidateDetector';
export * from './detectors/CrossPartitionQueryDetector';
export * from './detectors/ShardKeyMisalignmentDetector';
export * from './detectors/UncontrolledIngestionDetector';
export * from './detectors/SharedThroughputStarvationDetector';

export * from './fetchers/metrics';
export * from './fetchers/logs';
