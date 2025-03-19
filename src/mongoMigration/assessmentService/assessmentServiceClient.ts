/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscodelc from 'vscode-languageclient';
import { RequestType } from "vscode-languageclient";
import { ext } from '../../extensionVariables';

export interface AssessmentMetadata {
    assessmentId: string;
    assessmentName: string;
    assessmentStatus: string;
    startTime: Date;
    endTime: Date;
    TargetPlatform: EnumTargetOffering;
}

export enum EnumTargetOffering {
    None = 0,
    CosmosDBMongoRU = 1,
    CosmosDBMongovCore = 2
}

export interface RPCResponseEntity<T> {
    body: T,
    error: ErrorEntity,
    Warnings: WarningEntity[]
}

export interface ErrorEntity {
    errorCode: string,
    errorMessage: string,
    errorParameters: string[],
}

export interface WarningEntity {
    warningCode: string,
    warningParameters: string[]
}

export const GetAllAssessmentsApi = 'assessments/getAllAssessments';

export const getAllAssessmentsrequestType =
    new RequestType<AssessmentListRequestParameter, RPCResponseEntity<AssessmentMetadata[]>, void, void>(GetAllAssessmentsApi);

export interface AssessmentListRequestParameter {
    AssessmentFolderPath: string,
    InstanceId: string,
}

export class AssessmentServiceClient {

    protected get getAllAssessmentsRequestType(): vscodelc.RequestType<AssessmentListRequestParameter, RPCResponseEntity<AssessmentMetadata[]>, void, void> {
        return getAllAssessmentsrequestType;
    }

    public async getAllAssessments(): Promise<AssessmentMetadata[]> {
        const response: AssessmentMetadata[] = [];
        try {
            //  const instanceIdHash = "9966ba26e354b9d88cb313a7f19991cc13a3bdb0e7be54cce31dc31a90feba7c";
            // const response1 = await backendService.sendRequest<RPCResponseEntity<AssessmentMetadata[]>>(this.getAllAssessmentsRequestType.method, <AssessmentListRequestParameter>{
            //     InstanceId: instanceIdHash,
            //     AssessmentFolderPath: "C:/Users/bhpalaks/.dmamongo",
            // });

            // // TODO: refactor code to a cleaner one.
            // if (response1.error === null) {
            //     response = response1.body;
            // }
            // else {
            //     ext.outputChannel.appendLine(response1.error.errorMessage);
            // }

        } catch (e) {
            // log exception
            ext.outputChannel.appendLine(`Error in getAllAssessments: ${e}`);
        }
        return response;
    }
}
