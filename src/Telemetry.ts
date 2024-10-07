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

    public reportWebviewEvent = (
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

    /**
     * Report error from webview to telemetry
     * @param message
     * @param stack
     * @param componentStack
     * @returns
     */
    public reportWebviewError = (message: string, stack: string, componentStack: string | undefined): Promise<void> =>
        callWithTelemetryAndErrorHandling<void>('cosmosdb.common.query-tab.webview-error', (actionContext) => {
            actionContext.errorHandling.suppressDisplay = true;
            actionContext.valuesToMask = Array.from(this.valuesToMask);

            const newError = new Error(message);
            // If it's a rendering error in the webview, swap the stack with the componentStack which is more helpful
            newError.stack = componentStack ?? stack;
            throw newError;
        });

    public addMaskedValue(value: string | string[]): void {
        if (Array.isArray(value)) {
            value.filter((v) => !!v).forEach((v) => this.valuesToMask.add(v));
        } else if (value) {
            this.valuesToMask.add(value);
        }
    }
}
