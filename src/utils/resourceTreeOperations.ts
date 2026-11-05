/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';

// Structural compatibility until the Azure Resources API package publishes explicit operation contexts.
export interface ResourceTreeOperationContext {
    propagateErrors?: boolean;
}

/**
 * Preserves an explicit loading failure even when telemetry consumes cancellation.
 * No resource identifiers, paths, or error contents are added to telemetry by this helper.
 */
export async function callWithResourceTreeErrorHandling<T>(
    event: string,
    callback: (context: IActionContext) => T | Promise<T>,
    options?: ResourceTreeOperationContext,
): Promise<T | undefined> {
    let failure: { error: unknown } | undefined;
    const result = await callWithTelemetryAndErrorHandling(event, async (context) => {
        if (options?.propagateErrors) {
            context.errorHandling.suppressDisplay = true;
            context.errorHandling.suppressReportIssue = true;
        }
        try {
            return await callback(context);
        } catch (error) {
            if (options?.propagateErrors) {
                failure = { error };
            }
            throw error;
        }
    });
    if (failure) {
        throw failure.error;
    }
    return result;
}
