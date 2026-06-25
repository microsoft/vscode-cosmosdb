/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * .NET SDK detection and acquisition helpers used by the Cosmos DB Shell install flow.
 *
 * The CosmosDBShell tool is distributed as a `dotnet tool` global package, so installing
 * it (and keeping the user happy when it's missing) requires both a `dotnet` CLI on PATH
 * *and* an SDK whose version satisfies {@link MIN_DOTNET_SDK_VERSION}.
 */
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as child from 'child_process';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';

/**
 * Minimum .NET SDK version required to install the Cosmos DB Shell global tool.
 * Bumping this constant also updates the version requested via
 * `dotnet.acquireGlobalSDK` and the user-facing prompt copy.
 */
export const MIN_DOTNET_SDK_VERSION = '10.0.203';

/**
 * Channel (`major.minor`) requested from `dotnet.acquireGlobalSDK`. Using a
 * channel rather than {@link MIN_DOTNET_SDK_VERSION} lets the .NET Install Tool
 * resolve to the latest available patch on that channel while still satisfying
 * the floor enforced by {@link hasRequiredDotNetSdk}.
 */
export const REQUESTED_DOTNET_SDK_CHANNEL = MIN_DOTNET_SDK_VERSION.split('.').slice(0, 2).join('.');

/**
 * Compares two .NET SDK version strings (e.g. `10.0.203`, `9.0.100-rc.1`) by
 * numeric major / minor / patch components. Any pre-release / build metadata
 * suffix (after `-`) is ignored. Returns a negative number when `a < b`, zero
 * when equal, and a positive number when `a > b`.
 */
export function compareDotNetVersions(a: string, b: string): number {
    const parse = (v: string): number[] =>
        v
            .split('-')[0]
            .split('.')
            .map((part) => Number.parseInt(part, 10) || 0);
    const av = parse(a);
    const bv = parse(b);
    const len = Math.max(av.length, bv.length);
    for (let i = 0; i < len; i++) {
        const diff = (av[i] ?? 0) - (bv[i] ?? 0);
        if (diff !== 0) {
            return diff;
        }
    }
    return 0;
}

/**
 * Runs `dotnet --list-sdks` and returns the parsed version strings. The CLI
 * output format is `<version> [<install-path>]` per line. Returns an empty
 * array when `dotnet` is not on PATH or the call fails.
 */
export function getInstalledDotNetSdkVersions(dotnetPath?: string): string[] {
    try {
        const output = child.execFileSync(dotnetPath ?? 'dotnet', ['--list-sdks'], {
            windowsHide: true,
            stdio: 'pipe',
        });
        return output
            .toString('utf8')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => line.split(/\s+/, 1)[0]);
    } catch {
        return [];
    }
}

export function hasRequiredDotNetSdk(dotnetPath?: string): boolean {
    return getInstalledDotNetSdkVersions(dotnetPath).some(
        (version) => compareDotNetVersions(version, MIN_DOTNET_SDK_VERSION) >= 0,
    );
}

/**
 * Awaits the `.NET Install Tool` SDK acquisition command, requesting a global
 * install of the latest patch available on {@link REQUESTED_DOTNET_SDK_CHANNEL}.
 * Returns the resolved `dotnet` executable path on success, or undefined when
 * the acquisition failed or did not return a path.
 *
 * Uses `dotnet.acquireGlobalSDK` rather than `dotnet.acquireGlobalSDKPublic`
 * because the public variant ignores the supplied `version` and prompts the
 * user with its own recommended version instead.
 */
export async function tryInstallDotNetSdkViaExtension(): Promise<string | undefined> {
    const result = await callWithTelemetryAndErrorHandling(
        'cosmosDB.cosmosDBShell.install.dotnetSdk',
        async (telemetryContext: IActionContext) => {
            telemetryContext.errorHandling.suppressDisplay = true;
            telemetryContext.telemetry.properties.requestedChannel = REQUESTED_DOTNET_SDK_CHANNEL;
            const startedAt = Date.now();
            try {
                await vscode.commands.executeCommand('dotnet.showAcquisitionLog');
                const acquisition = await vscode.commands.executeCommand<{ dotnetPath?: string } | undefined>(
                    'dotnet.acquireGlobalSDK',
                    {
                        version: REQUESTED_DOTNET_SDK_CHANNEL,
                        requestingExtensionId: ext.context.extension.id,
                        installType: 'global',
                    },
                );
                telemetryContext.telemetry.measurements.durationMs = Date.now() - startedAt;
                const dotnetPath = acquisition?.dotnetPath;
                telemetryContext.telemetry.properties.pathReturned = String(!!dotnetPath);
                telemetryContext.telemetry.properties.satisfiesMinSdk = dotnetPath
                    ? String(hasRequiredDotNetSdk(dotnetPath))
                    : 'false';
                telemetryContext.telemetry.properties.outcome = dotnetPath ? 'success' : 'noPath';
                return dotnetPath;
            } catch (err) {
                telemetryContext.telemetry.measurements.durationMs = Date.now() - startedAt;
                telemetryContext.telemetry.properties.outcome = 'failure';
                ext.outputChannel.appendLine(`dotnet.acquireGlobalSDK failed: ${String(err)}`);
                throw err;
            }
        },
    );
    return result;
}
