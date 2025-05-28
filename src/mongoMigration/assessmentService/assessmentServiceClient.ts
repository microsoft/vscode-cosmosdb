/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { type Duplex } from 'stream';
import * as vscode from 'vscode';
// eslint-disable-next-line import/no-internal-modules
import * as rpc from 'vscode-jsonrpc/node';
import { ext } from '../../extensionVariables';
import type * as AssessmentTypes from './assessmentServiceInterfaces';

export class AssessmentServiceClient {
    private static connection: rpc.MessageConnection | null = null;
    static default_folder = '.dmamongo';

    /**
     * Ensures the connection to the RPC server is established.
     */
    public static async establishConnection(): Promise<void> {
        if (!this.connection) {
            ext.outputChannel.appendLine('Connection not initialized. Establishing connection...');
            await this.connectToRpcServerAsync();
        }
    }

    /**
     * Connects to the RPC server and initializes the connection.
     */
    private static async connectToRpcServerAsync(): Promise<void> {
        const pipeName = '\\\\.\\pipe\\MongoAssessmentServerJsonRpcStream';
        const client = net.createConnection(pipeName);

        client.on('connect', () => {
            ext.outputChannel.appendLine('Connected to pipe...');
            this.initializeConnection(client);
        });

        client.on('error', (error) => {
            ext.outputChannel.appendLine('Error connecting to RPC server: ' + error.message);
        });

        client.on('close', () => {
            ext.outputChannel.appendLine('Connection to RPC server closed.');
            this.connection = null;
        });

        // Wait for the connection to be established
        await new Promise<void>((resolve, reject) => {
            client.once('connect', resolve);
            client.once('error', reject);
        });
    }

    /**
     * Initializes the RPC connection using the provided stream.
     * @param stream The duplex stream for communication.
     */
    private static initializeConnection(stream: Duplex): void {
        const messageReader = new rpc.StreamMessageReader(stream);
        const messageWriter = new rpc.StreamMessageWriter(stream);
        this.connection = rpc.createMessageConnection(messageReader, messageWriter);
        this.connection.listen();
        ext.outputChannel.appendLine('RPC connection initialized.');
    }

    /**
     * Sends a request to the RPC server.
     * @param method The name of the RPC method to call.
     * @param params The parameters to send with the request (can be variable).
     * @returns The response from the server.
     */
    private static async sendRequest<T>(method: string, ...params: unknown[]): Promise<T> {
        try {
            ext.outputChannel.appendLine(`Sending request to method: ${method} with params: ${JSON.stringify(params)}`);
            const response = await this.connection!.sendRequest<T>(method, ...params);
            return response;
        } catch (error) {
            ext.outputChannel.appendLine(`Error in RPC call to ${method}: ${error}`);
            throw error;
        }
    }

    private static getDefaultAssessmentPath(): string {
        return path.join(os.homedir(), this.default_folder);
    }

    /**
     * Calls the `CheckPrerequisiteAsync` RPC method.
     * @param input The input parameters for the method.
     * @returns The response from the server.
     */
    public static async checkPrerequisite(
        input: AssessmentTypes.CheckPrerequisiteInput,
    ): Promise<AssessmentTypes.RPCResponseEntity<{ IsPreReqSatisfied: boolean }>> {
        return this.sendRequest<AssessmentTypes.RPCResponseEntity<{ IsPreReqSatisfied: boolean }>>(
            'CheckPrerequisiteAsync',
            input,
            /* Assessment client for telemetry */ null,
        );
    }

    /**
     * Calls the `GetAllAssessments` RPC method.
     * @returns A list of assessment metadata wrapped in RPCResponseEntity.
     */
    public static async getAllAssessments(
        input: AssessmentTypes.AssessmentListRequestParameter,
    ): Promise<AssessmentTypes.RPCResponseEntity<AssessmentTypes.AssessmentMetadata[]>> {
        input.assessmentFolderPath = this.getDefaultAssessmentPath();
        return this.sendRequest<AssessmentTypes.RPCResponseEntity<AssessmentTypes.AssessmentMetadata[]>>(
            'GetAllAssessmentsAsync',
            input,
            /* Assessment client for telemetry */ null,
        );
    }

    /**
     * Calls the `GetAssessmentDetails` RPC method.
     * @returns Details of one Assessment.
     */
    public static async getAssessmentDetails(
        input: AssessmentTypes.AssessmentRequestParameters,
    ): Promise<AssessmentTypes.RPCResponseEntity<AssessmentTypes.AssessmentDetails>> {
        input.assessmentFolderPath = this.getDefaultAssessmentPath();
        return this.sendRequest<AssessmentTypes.RPCResponseEntity<AssessmentTypes.AssessmentDetails>>(
            'GetAssessmentDetailsAsync',
            input,
            /* Assessment client for telemetry */ null,
        );
    }

    /**
     * Calls the `GetInstanceSummaryReportAsync` RPC method.
     * @returns Returns Instance summary from assessment report.
     */
    public static async getInstanceSummary(
        input: AssessmentTypes.AssessmentRequestParameters,
    ): Promise<AssessmentTypes.RPCResponseEntity<AssessmentTypes.InstanceSummaryResponse>> {
        input.assessmentFolderPath = this.getDefaultAssessmentPath();
        return this.sendRequest<AssessmentTypes.RPCResponseEntity<AssessmentTypes.InstanceSummaryResponse>>(
            'GetInstanceSummaryReportAsync',
            input,
            /* Assessment client for telemetry */ null,
        );
    }
    /**
     * Calls the `StartAssessmentAsync` RPC method.
     * @returns Starts an Assessment.
     */
    public static async startAssessment(
        input: AssessmentTypes.AssessmentWorkflowParameters,
    ): Promise<AssessmentTypes.RPCResponseEntity<AssessmentTypes.StartAssessmentResponse>> {
        input.assessmentFolderPath = this.getDefaultAssessmentPath();
        return this.sendRequest<AssessmentTypes.RPCResponseEntity<AssessmentTypes.StartAssessmentResponse>>(
            'StartAssessmentAsync',
            input,
            /*Assessment client for telemetry*/ null,
        );
    }

    /**
     * Calls the `DeleteAssessmentAsync` RPC method.
     * @returns Deletes an Assessment.
     */
    public static async deleteAssessment(input: AssessmentTypes.AssessmentRequestParameters): Promise<boolean> {
        input.assessmentFolderPath = this.getDefaultAssessmentPath();
        return this.sendRequest<boolean>('DeleteAssessmentAsync', input, /*Assessment client for telemetry*/ null);
    }

    /**
     * Calls the `CancelAssessmentAsync` RPC method.
     * @returns Cancels an Assessment.
     */
    public static async cancelAssessment(assessmentId: string): Promise<boolean> {
        return this.sendRequest<boolean>(
            'CancelAssessmentAsync',
            assessmentId,
            /*Assessment client for telemetry*/ null,
        );
    }

    /**
     * Calls the `GetAssessmentReportAsync` RPC method.
     * @returns Returns an Assessment Report for particular assessment type.
     */
    public static async getAssessmentReport(
        input: AssessmentTypes.AssessmentReportRequestParameters,
    ): Promise<AssessmentTypes.GetAssessmentReportResponse> {
        input.assessmentFolderPath = this.getDefaultAssessmentPath();
        return this.sendRequest<AssessmentTypes.GetAssessmentReportResponse>(
            'GetAssessmentReportAsync',
            input,
            /*Assessment client for telemetry*/ null,
        );
    }

    /**
     * Calls the `GetCombinedAssessmentReportAsync` RPC method.
     * @returns Returns a combined Assessment Report.
     */
    public static async getCombinedAssessmentReport(
        input: AssessmentTypes.AssessmentReportRequestParameters,
    ): Promise<AssessmentTypes.RPCResponseEntity<AssessmentTypes.GetAssessmentReportResponse>> {
        input.assessmentFolderPath = this.getDefaultAssessmentPath();
        return this.sendRequest<AssessmentTypes.RPCResponseEntity<AssessmentTypes.GetAssessmentReportResponse>>(
            'GetCombinedAssessmentReportAsync',
            input,
            /* Assessment client for telemetry */ null,
        );
    }
    public static async downloadHtmlToDisk(
        filename: string,
        content: string,
    ): Promise<{ success: boolean; path?: string }> {
        const uri = await vscode.window.showSaveDialog({
            title: 'Save HTML Report',
            defaultUri: vscode.Uri.file(filename),
            filters: { 'HTML Files': ['html'] },
        });

        if (!uri) {
            vscode.window.showWarningMessage('Download cancelled.');
            return { success: false };
        }

        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        vscode.window.showInformationMessage(`Report saved to ${uri.fsPath}`);

        return { success: true, path: uri.fsPath };
    }
}
