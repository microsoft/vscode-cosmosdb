/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TestUserInput } from './TestUserInput';

export interface TestActionContext {
    telemetry: {
        properties: { [key: string]: string | undefined };
        measurements: { [key: string]: number | undefined };
    };
    errorHandling: {
        issueProperties: object;
    };
    valuesToMask: string[];
    ui: TestUserInput;
}

export async function createTestActionContext(): Promise<TestActionContext> {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
        ui: await TestUserInput.create(),
    };
}

/**
 * Similar to `createTestActionContext` but with some extra logging
 */
export async function runWithTestActionContext(
    callbackId: string,
    callback: (context: TestActionContext) => Promise<void>,
): Promise<void> {
    const context = await createTestActionContext();
    const start: number = Date.now();
    try {
        await callback(context);
    } finally {
        const end: number = Date.now();
        context.telemetry.measurements.duration = (end - start) / 1000;
        console.log(
            `** TELEMETRY(${callbackId}) properties=${JSON.stringify(context.telemetry.properties)}, measurements=${JSON.stringify(context.telemetry.measurements)}`,
        );
    }
}
