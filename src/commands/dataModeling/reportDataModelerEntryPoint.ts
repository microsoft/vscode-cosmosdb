/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';

/**
 * Records a click independently of launch failures that suppress the caller's telemetry.
 * No file contents, paths, or names are emitted.
 */
export async function reportDataModelerEntryPoint(entryPoint: 'createDatabase' | 'createContainer'): Promise<void> {
    await callWithTelemetryAndErrorHandling('cosmosDB.dataModeler.entryPointSelected', async (context) => {
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.rethrow = false;
        context.telemetry.properties.entryPoint = entryPoint;
    });
}
