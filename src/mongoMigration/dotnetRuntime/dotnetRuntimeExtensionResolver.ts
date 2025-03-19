/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { type IDotnetAcquireResult, type IDotnetFindPathContext } from './dotnetRuntimeExtensionApi';

const DotNetMajorVersion = '8';
const DotNetMinorVersion = '0';
const DotNetPatchVersion = '0';
export const DotNetRuntimeVersion = `${DotNetMajorVersion}.${DotNetMinorVersion}.${DotNetPatchVersion}`;

const extensionId = "vscode-cosmosdb";

interface DotNetHostInformation {
    version: string;
    path: string;
    env: NodeJS.ProcessEnv;
}

/**
 * Resolves the dotnet runtime for a server executable from given options and the dotnet runtime VSCode extension.
 */
export class DotnetRuntimeExtensionResolver {
    constructor(
        private channel: vscode.OutputChannel,
    ) { }

    private hostInfo: DotNetHostInformation | undefined;

    async getDotNetHostInfo(): Promise<DotNetHostInformation> {
        if (this.hostInfo) {
            return this.hostInfo;
        }

        this.channel.appendLine(`Locating .NET runtime version ${DotNetRuntimeVersion}`);
        const extensionArchitecture = process.arch;
        const findPathRequest: IDotnetFindPathContext = {
            acquireContext: {
                version: DotNetRuntimeVersion,
                requestingExtensionId: extensionId,
                architecture: extensionArchitecture,
                mode: 'runtime',
            },
            versionSpecRequirement: 'greater_than_or_equal',
        };
        let acquireResult = await vscode.commands.executeCommand<IDotnetAcquireResult | undefined>(
            'dotnet.findPath',
            findPathRequest
        );
        if (acquireResult === undefined) {
            this.channel.appendLine(
                `Did not find .NET ${DotNetRuntimeVersion} on path, falling back to acquire runtime via ms-dotnettools.vscode-dotnet-runtime`
            );
            acquireResult = await this.acquireDotNetProcessDependencies();
        }

        const dotnetExecutablePath = acquireResult.dotnetPath;

        const hostInfo = {
            version: '' /* We don't need to know the version - we've already downloaded the correct one */,
            path: dotnetExecutablePath,
            env: this.getEnvironmentVariables(dotnetExecutablePath),
        };
        this.hostInfo = hostInfo;
        return hostInfo;
    }

    private getEnvironmentVariables(dotnetExecutablePath: string): NodeJS.ProcessEnv {
        // Take care to always run .NET processes on the runtime that we intend.
        // The dotnet.exe we point to should not go looking for other runtimes.
        const env: NodeJS.ProcessEnv = { ...process.env };
        env.DOTNET_ROOT = path.dirname(dotnetExecutablePath);
        env.DOTNET_MULTILEVEL_LOOKUP = '0';
        // Save user's DOTNET_ROOT env-var value so server can recover the user setting when needed
        env.DOTNET_ROOT_USER = process.env.DOTNET_ROOT ?? 'EMPTY';

        // Enable dump collection
        env.DOTNET_DbgEnableMiniDump = '1';
        // Collect heap dump
        env.DOTNET_DbgMiniDumpType = '2';
        // Collect crashreport.json with additional thread and stack frame information.
        env.DOTNET_EnableCrashReport = '1';
        // The dump file name format is <executable>.<pid>.dmp
        env.DOTNET_DbgMiniDumpName = "";// path.join(languageServerOptions.crashDumpPath, '%e.%p.dmp');

        return env;
    }

    /**
     * Acquires the .NET runtime if it is not already present.
     * @returns The path to the .NET runtime
     */
    private async acquireRuntime(): Promise<IDotnetAcquireResult> {
        // The runtime extension doesn't support specifying a patch versions in the acquire API, so we only use major.minor here.
        // That is generally OK, as acquisition will always acquire the latest patch version.
        const dotnetAcquireVersion = `${DotNetMajorVersion}.${DotNetMinorVersion}`;
        let status = await vscode.commands.executeCommand<IDotnetAcquireResult>('dotnet.acquireStatus', {
            version: dotnetAcquireVersion,
            requestingExtensionId: extensionId,
        });
        if (status === undefined) {
            await vscode.commands.executeCommand('dotnet.showAcquisitionLog');

            status = await vscode.commands.executeCommand<IDotnetAcquireResult>('dotnet.acquire', {
                version: dotnetAcquireVersion,
                requestingExtensionId: extensionId,
            });
            if (!status) {
                throw new Error('Could not resolve the dotnet path!');
            }
        }

        return status;
    }

    /**
     * Acquires the .NET runtime and any other dependencies required to spawn a particular .NET executable.
     * @param path The path to the entrypoint assembly. Typically a .dll.
     */
    private async acquireDotNetProcessDependencies(): Promise<IDotnetAcquireResult> {
        const acquireResult = await this.acquireRuntime();
        return acquireResult;
    }

}
