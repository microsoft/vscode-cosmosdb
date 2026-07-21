/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Detector } from './core/Detector';
import { autoscaleCandidateDetector } from './detectors/AutoscaleCandidateDetector';
import { autoscaleMaxOverProvisionedDetector } from './detectors/AutoscaleMaxOverProvisionedDetector';
import { autoscaleToManualCandidateDetector } from './detectors/AutoscaleToManualCandidateDetector';
import { crossPartitionQueryDetector } from './detectors/CrossPartitionQueryDetector';
import { expensiveConsistencyDetector } from './detectors/ExpensiveConsistencyDetector';
import { hotPartitionRiskDetector } from './detectors/HotPartitionRiskDetector';
import { idleContainerDetector } from './detectors/IdleContainerDetector';
import { indexingCostRiskDetector } from './detectors/IndexingCostRiskDetector';
import { multiRegionWriteAntipatternDetector } from './detectors/MultiRegionWriteAntipatternDetector';
import { overProvisioningDetector } from './detectors/OverProvisioningDetector';
import { partitionMergeCandidateDetector } from './detectors/PartitionMergeCandidateDetector';
import { serverlessCandidateDetector } from './detectors/ServerlessCandidateDetector';
import { shardKeyMisalignmentDetector } from './detectors/ShardKeyMisalignmentDetector';
import { sharedThroughputStarvationDetector } from './detectors/SharedThroughputStarvationDetector';
import { storageGrowthRiskDetector } from './detectors/StorageGrowthRiskDetector';
import { storageSkewRiskDetector } from './detectors/StorageSkewRiskDetector';
import { uncontrolledIngestionDetector } from './detectors/UncontrolledIngestionDetector';
import { underProvisioningDetector } from './detectors/UnderProvisioningDetector';

/**
 * Every derived-advisory detector, in evaluation order. Suppression (ShardKeyMisalignment supersedes
 * CrossPartitionQuery on the same scope) is applied by the engine and is order-independent, so ShardKey is listed
 * before CrossPartition here purely for readability.
 */
export const DETECTORS: readonly Detector[] = [
    hotPartitionRiskDetector,
    underProvisioningDetector,
    overProvisioningDetector,
    autoscaleCandidateDetector,
    storageGrowthRiskDetector,
    storageSkewRiskDetector,
    indexingCostRiskDetector,
    expensiveConsistencyDetector,
    multiRegionWriteAntipatternDetector,
    idleContainerDetector,
    partitionMergeCandidateDetector,
    autoscaleMaxOverProvisionedDetector,
    autoscaleToManualCandidateDetector,
    serverlessCandidateDetector,
    shardKeyMisalignmentDetector,
    crossPartitionQueryDetector,
    uncontrolledIngestionDetector,
    sharedThroughputStarvationDetector,
];
