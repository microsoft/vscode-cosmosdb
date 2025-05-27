/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface AssessmentMetadata {
    AssessmentId: string;
    AssessmentName: string;
    AssessmentStatus: string;
    StartTime: string;
    EndTime: string;
    TargetPlatform: EnumTargetOffering;
}

export interface AssessmentRequestParameters {
    instanceId: string;
    assessmentId: string;
    assessmentName: string;
    assessmentFolderPath: string;
}

export enum EnumTargetOffering {
    None = 0,
    CosmosDBMongoRU = 1,
    CosmosDBMongovCore = 2,
}

export interface RPCResponseEntity<T> {
    Body: T;
    error: ErrorEntity;
    Warnings: WarningEntity[];
}

export interface ErrorEntity {
    errorCode: string;
    errorMessage: string;
    errorParameters: string[];
}

export interface WarningEntity {
    warningCode: string;
    warningParameters: string[];
}

export interface AssessmentListRequestParameter {
    assessmentFolderPath: string;
    instanceId: string;
}

export interface CheckPrerequisiteInput {
    connectionString: string;
    assessmentId: string;
}

export interface AssessmentDetails {
    assessmentId: string;
    assessmentName: string;
    assessmentStatus: string;
    startTime: Date;
    endTime: Date;
    targetPlatform: EnumTargetOffering;
    logFolderPath: string;
    assessmentProgress: AssessmentProgress[];
}

export interface AssessmentProgress {
    assessmentStage: string;
    assessmentStatus: string;
    stageDuration: string;
    errorInfo: ErrorEntity[];
    innerException: string;
    warningInfo: WarningEntity[];
}

export interface GetAssessmentReportResponse {
    assessments: AssessmentData[];
}

export interface AssessmentData {
    databaseName: string;
    collectionName: string;
    assessmentCategory: string;
    assessmentSeverity: string;
    description: string;
    moreInfo: MoreInfo;
    message: string;
    additionalDetails: string;
}

export interface MoreInfo {
    href: string;
    label: string;
}

export interface InstanceSummaryResponse {
    instanceType: string;
    sourceVersion: string;
    licenseType: string;
    upTimeInMilliSeconds: string;
    serverStartTime: Date;
    totalDatabaseCount: number;
    databaseSummary: DatabaseSummary[];
    totalCollectionCount: number;
    collectionSummary: CollectionSummary[];
    totalTimeseriesCount: number;
    totalViewsCount: number;
    totalIndexesCount: number;
}

export interface DatabaseSummary {
    databaseName: string;
    collectionCount: number;
    viewCount: number;
    timeSeriesCount: number;
    dataSize: number;
}

export interface CollectionSummary {
    databaseName: string;
    collectionName: string;
    type: string;
    isSharded: boolean;
    shardKey: string;
    documentCount: number;
    indexCount: number;
    dataSize: number;
    indexSize: number;
    averageDocumentSize: number;
}

export interface AssessmentWorkflowParameters {
    instanceId: string;
    assessmentName: string | undefined;
    assessmentId: string;
    logFolderPath: string | undefined;
    targetPlatform: EnumTargetOffering;
    connectionString: string;
    assessmentFolderPath: string;
    dataAssessmentReportPath: string | undefined;
}

export interface StartAssessmentResponse {
    assessmentId: string;
    startTime: Date;
}

// // Define and export AssessmentProgressNotification
// export interface AssessmentProgressNotification {
//     assessmentId: string,
//     assessmentStage: string,
//     stageStatus: string,
//     stageDuration: string,
//     error?: ErrorEntity[],
//     innerException?: string,
//     warning?: WarningEntity[]
// }

export enum AssessmentStatus {
    SUCCESS = 'Successful',
    INPROGRESS = 'InProgress',
    WAITING = 'Waiting',
    FAILED = 'Failed',
    WARNING = 'Warning',
    ABORTED = 'Aborted',
    CANCELLED = 'Cancelled',
}

export interface AssessmentReportRequestParameters {
    instanceId: string;
    assessmentId: string;
    assessmentName: string;
    assessmentFolderPath: string;
    assessmentType?: EnumAssessmentType;
}

export enum EnumAssessmentType {
    CollectionOptions = 'CollectionOptions',
    Features = 'Features',
    Index = 'Index',
    LimitsAndQuotas = 'LimitsAndQuotas',
    ShardKey = 'ShardKey',
}

export interface GetAssessmentReportResponse {
    assessments: AssessmentData[];
}
