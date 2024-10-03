/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { type NoSqlQueryConnection } from './docdb/NoSqlCodeLensProvider';

export class TelemetryContext {
    private valuesToMask = new Set<string>();

    constructor(connection: NoSqlQueryConnection | undefined) {
        if (connection) {
            if (connection.masterKey) {
                this.addMaskedValue(connection.masterKey);
            }
            this.addMaskedValue(connection.databaseId);
            this.addMaskedValue(connection.containerId);
        }
    }

    public reportEvent = (
        eventName: string,
        properties?: Record<string, string>,
        measurements?: Record<string, number>,
    ): Promise<void> =>
        callWithTelemetryAndErrorHandling<void>(`cosmosDB.nosql.queryEditor.${eventName}`, (context) => {
            context.errorHandling.suppressDisplay = true;
            context.valuesToMask = Array.from(this.valuesToMask);
            Object.assign(context.telemetry.properties, properties ?? {});
            Object.assign(context.telemetry.measurements, measurements ?? {});
        });

    public reportError = (message: string, stack: string, componentStack: string | undefined): Promise<void> =>
        callWithTelemetryAndErrorHandling<void>('cosmosDB.nosql.queryEditor.webviewError', (actionContext) => {
            actionContext.errorHandling.suppressDisplay = true;
            actionContext.valuesToMask = Array.from(this.valuesToMask);

            const newError = new Error(message);
            // If it's a rendering error in the webview, swap the stack with the componentStack which is more helpful
            newError.stack = componentStack ?? stack;
            throw newError;
        });

    public addMaskedValue(value: string): void {
        this.valuesToMask.add(value);
    }
}