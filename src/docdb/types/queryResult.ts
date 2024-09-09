import { type QueryMetrics } from '@azure/cosmos';

export type QueryResult = {
    activityId?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    documents: any[];
    queryMetrics: QueryMetrics;
    requestCharge: number;
    roundTrips: number;
};

export type SerializedQueryMetrics = {
    documentLoadTime: number;
    documentWriteTime: number;
    indexHitDocumentCount: number;
    outputDocumentCount: number;
    outputDocumentSize: number;
    indexLookupTime: number;
    retrievedDocumentCount: number;
    retrievedDocumentSize: number;
    vmExecutionTime: number;
    runtimeExecutionTimes: {
        queryEngineExecutionTime: number;
        systemFunctionExecutionTime: number;
        userDefinedFunctionExecutionTime: number;
    };
    totalQueryExecutionTime: number;
};

export type SerializedQueryResult = {
    activityId?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    documents: any[];
    queryMetrics: SerializedQueryMetrics;
    requestCharge: number;
    roundTrips: number;
};
