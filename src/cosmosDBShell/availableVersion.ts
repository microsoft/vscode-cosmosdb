/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createDefaultHttpClient,
    createPipelineFromOptions,
    createPipelineRequest,
    type PipelineResponse,
} from '@azure/core-rest-pipeline';
import * as l10n from '@vscode/l10n';
import * as semver from 'semver';
import { ext } from '../extensionVariables';

const COSMOS_DB_SHELL_PACKAGE_INDEX_URL = 'https://api.nuget.org/v3-flatcontainer/cosmosdbshell/index.json';
const VERSION_CHECK_TIMEOUT_MS = 5000;

type PackageIndexResponse = Pick<PipelineResponse, 'status' | 'bodyAsText'>;
type PackageIndexRequest = () => Promise<PackageIndexResponse>;

export async function logAvailableCosmosDBShellUpdate(
    installedVersion: string | undefined,
    customShellPathConfigured: boolean,
    requestPackageIndex: PackageIndexRequest = getPackageIndex,
): Promise<void> {
    if (!installedVersion || !semver.valid(installedVersion)) {
        return;
    }

    try {
        const response = await requestPackageIndex();
        if (response.status !== 200 || !response.bodyAsText) {
            throw new Error(`NuGet returned HTTP ${response.status}.`);
        }

        const latestVersion = getLatestPackageVersion(response.bodyAsText);
        if (latestVersion && semver.gt(latestVersion, installedVersion)) {
            ext.outputChannel.info(
                customShellPathConfigured
                    ? l10n.t(
                          'A newer Cosmos DB Shell version is available: {0} (installed: {1}). A custom Cosmos DB Shell path is configured; update that installation manually.',
                          latestVersion,
                          installedVersion,
                      )
                    : l10n.t(
                          'A newer Cosmos DB Shell version is available: {0} (installed: {1}). To update, run: dotnet tool update --global CosmosDBShell --prerelease',
                          latestVersion,
                          installedVersion,
                      ),
            );
        }
    } catch (error) {
        ext.outputChannel.debug(`Unable to check for Cosmos DB Shell updates: ${String(error)}`);
    }
}

export function getLatestPackageVersion(packageIndexJson: string): string | undefined {
    const packageIndex = JSON.parse(packageIndexJson) as { versions?: unknown };
    if (!Array.isArray(packageIndex.versions)) {
        return undefined;
    }

    const validVersions = packageIndex.versions.filter(
        (version): version is string => typeof version === 'string' && semver.valid(version) !== null,
    );
    return semver.rsort(validVersions)[0];
}

async function getPackageIndex(): Promise<PackageIndexResponse> {
    const pipeline = createPipelineFromOptions({});
    const request = createPipelineRequest({
        url: COSMOS_DB_SHELL_PACKAGE_INDEX_URL,
        method: 'GET',
        timeout: VERSION_CHECK_TIMEOUT_MS,
    });
    return pipeline.sendRequest(createDefaultHttpClient(), request);
}
