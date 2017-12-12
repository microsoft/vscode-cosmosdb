/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ErrorData } from './ErrorData';
import vscode = require('vscode');
import * as vscodeUtil from './vscodeUtils';
import { UserCancelledError } from 'vscode-azureextensionui';
import TelemetryReporter from 'vscode-extension-telemetry';

export var reporter: TelemetryReporter;

export class Reporter extends vscode.Disposable {

    constructor(ctx: vscode.ExtensionContext) {

        super(() => reporter.dispose());

        let packageInfo = getPackageInfo(ctx);
        reporter = packageInfo && new TelemetryReporter(packageInfo.name, packageInfo.version, packageInfo.aiKey);

    }
}

interface IPackageInfo {
    name: string;
    version: string;
    aiKey: string;
}

function getPackageInfo(context: vscode.ExtensionContext): IPackageInfo {
    let extensionPackage = require(context.asAbsolutePath('./package.json'));
    if (extensionPackage) {
        return {
            name: extensionPackage.name,
            version: extensionPackage.version,
            aiKey: extensionPackage.aiKey
        };
    }
    return;
}

// Send telemetry for the extension
function sendTelemetry(eventName: string, properties?: { [key: string]: string; }, measures?: { [key: string]: number; }) {
    if (reporter) {
        reporter.sendTelemetryEvent(eventName, properties, measures);
    }
}

export async function callWithTelemetry<T>(eventName: string, callback: (telemetryProperties: { [key: string]: string; }, measurements: { [key: string]: number }) => Promise<void>): Promise<void> {
    const start = Date.now();
    let properties: { [key: string]: string; } = {};
    properties.result = 'Succeeded';
    let measurements: { [key: string]: number; } = {};
    let errorData: ErrorData | undefined = null;
    let result: T = undefined;

    try {
        await callback(properties, measurements);
    } catch (err) {
        if (err instanceof UserCancelledError) {
            properties.result = 'Canceled';
        }
        else {
            properties.result = 'Failed';
            errorData = new ErrorData(err);
        }

        throw err;
    } finally {
        if (errorData) {
            properties.error = errorData.errorType;
            properties.errorMessage = errorData.message;
        }
        const end = Date.now();
        measurements.duration = (end - start) / 1000;

        sendTelemetry(eventName, properties, measurements);
    }
}
