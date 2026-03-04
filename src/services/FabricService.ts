/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type IApiClientResponse,
    type IArtifact,
    type IArtifactHandler,
    type IWorkspace,
} from '@microsoft/vscode-fabric-api';
import * as l10n from '@vscode/l10n';
import vscode from 'vscode';
import { type FabricArtifactType } from '../constants';
import { parseCosmosDBConnectionString } from '../cosmosdb/cosmosDBConnectionStrings';
import { getCosmosDBCredentials } from '../cosmosdb/CosmosDBCredential';
import { ext } from '../extensionVariables';
import { type AccountInfo } from '../tree/cosmosdb/AccountInfo';

export const CosmosDbArtifactType = ['NATIVE', 'MIRRORED_KEY', 'MIRRORED_AAD'] as const;
export type CosmosDbArtifactType = (typeof CosmosDbArtifactType)[number];

export type ExtendedProperties = {
    accountEndpoint: string;
    databaseName: string;
    connectionId?: string;
    resourceTokens?: Record<string, string>;
};

export type ArtifactConnectionInfo = {
    type: CosmosDbArtifactType;

    accountInfo: AccountInfo;
    databaseName: string;
    accountEndpoint: string;

    // Optional. Mirrored DB might show only a subset of collections, so this is used to store the visible collections information
    // TODO: At this moment Public API does not expose these properties, however, Data Explorer supports them
    connectionId?: string; // Connection ID, might be different with endpoint
    resourceTokens?: Record<string, string>; // Information about visible collections
    isReadOnly?: boolean;
};

/**
 * Fabric service what works with public API
 */
export interface IFabricService {
    /**
     * Retrieves connection information for artifact
     * @param artifact
     */
    getArtifactConnectionInfo(artifact: IArtifact): Promise<ArtifactConnectionInfo>;

    getArtifactHandlers(artifactType: string): IArtifactHandler[];

    isArtifact(artifact: unknown): artifact is IArtifact;

    getWorkspace(artifact: CosmosDBArtifact): Promise<IWorkspace>;
}

type CosmosDBArtifact = IArtifact & { type: FabricArtifactType };

class FabricServiceImpl implements IFabricService {
    /**
     * Retrieves connection information for artifact
     * @param artifact
     */
    public async getArtifactConnectionInfo(artifact: CosmosDBArtifact): Promise<ArtifactConnectionInfo> | never {
        if (!ext.fabricServices) {
            throw new Error(l10n.t('Fabric Service is not initialized'));
        }

        const credentialType = await this.getCredentialType(artifact);
        const fullArtifact = await this.getFullArtifact(artifact);

        // TODO: implement Public API and required extended properties
        const extendedProperties = (fullArtifact.extendedProperties ?? {}) as ExtendedProperties;
        const accountEndpoint = `${extendedProperties?.accountEndpoint ?? ''}`; // https://0f25df82-0725-4a14-8706-651561309e4c.z0f.msit-sql.cosmos.fabric.microsoft.com:443/
        const databaseName = `${extendedProperties?.databaseName ?? ''}`; // languye-02-16
        const connectionId = extendedProperties?.connectionId; // 68a5afec-e417-4851-bf28-e0724cfdb939
        const resourceTokens = extendedProperties?.resourceTokens;

        const accountInfo = await this.getAccountInfo(artifact, credentialType, accountEndpoint);

        return {
            type: credentialType,

            accountInfo,
            databaseName,
            accountEndpoint,
            connectionId,
            resourceTokens,
            isReadOnly: true, // TODO: should get this from server
        };
    }

    public getArtifactHandlers(artifactType: FabricArtifactType): IArtifactHandler[] {
        if (artifactType === 'CosmosDBDatabase') {
            return [
                {
                    artifactType,
                    createWorkflow: {
                        showCreate: (): Promise<boolean | undefined> => Promise.resolve(true),
                        onBeforeCreate: (artifact: IArtifact): Promise<IArtifact | undefined> => {
                            const artifactName = artifact.displayName;
                            const regex = /^[^/?#\\]{0,264}[^/?# \\]$/;

                            if (!artifactName) {
                                throw new Error(l10n.t('Artifact name is required'));
                            }

                            if (artifactName.endsWith(' ')) {
                                throw new Error(l10n.t('Trailing space is not allowed'));
                            }

                            if (artifactName.length > 256) {
                                throw new Error(
                                    l10n.t('Name cannot be more than {maxLength} characters', {
                                        maxLength: 256,
                                    }),
                                );
                            }

                            if (!regex.test(artifactName)) {
                                throw new Error(
                                    l10n.t(
                                        "Invalid name for {currentName}. Value must be 1-265 characters, cannot contain '/', '?', '#', or '\\', and cannot end with a space or any of those characters.",
                                        {
                                            currentName: artifactName,
                                        },
                                    ),
                                );
                            }

                            return Promise.resolve(artifact);
                        },
                    },
                },
            ];
        }

        return [];
    }

    public async getWorkspace(artifact: CosmosDBArtifact): Promise<IWorkspace> {
        if (!ext.fabricServices) {
            throw new Error(l10n.t('Fabric Service is not initialized'));
        }

        const workspace = await ext.fabricServices.workspaceManager.getWorkspaceById(artifact.workspaceId);
        if (!workspace) {
            throw new Error(l10n.t('Workspace not found for id {0}', artifact.workspaceId));
        }

        return workspace;
    }

    public isArtifact(artifact: unknown): artifact is IArtifact {
        return (
            typeof artifact === 'object' &&
            artifact !== null &&
            'id' in artifact &&
            typeof artifact.id === 'string' &&
            'displayName' in artifact &&
            typeof artifact.displayName === 'string' &&
            'type' in artifact &&
            typeof artifact.type === 'string' &&
            'workspaceId' in artifact &&
            typeof artifact.workspaceId === 'string'
        );
    }

    protected async getFullArtifact(artifact: CosmosDBArtifact): Promise<IArtifact & Record<string, unknown>> {
        if (!ext.fabricServices) {
            throw new Error(l10n.t('Fabric Service is not initialized'));
        }

        const response = await ext.fabricServices?.artifactManager.getArtifact(artifact);
        if (response.status !== 200) {
            throw new Error(
                this.formatErrorResponse(
                    l10n.t('Error getting item for workspace {0}', artifact.workspaceId),
                    response,
                ),
            );
        }

        const fullArtifact: unknown = response.parsedBody;
        if (!this.isArtifact(fullArtifact)) {
            throw new Error(l10n.t('Artifact not found for id {0}', artifact.id));
        }

        return { ...artifact, ...fullArtifact } as IArtifact & Record<string, unknown>;
    }

    protected async getAccountInfo(
        artifact: CosmosDBArtifact,
        credentialType: CosmosDbArtifactType,
        accountEndpoint: string,
    ): Promise<AccountInfo> {
        if (!ext.fabricServices) {
            throw new Error(l10n.t('Fabric Service is not initialized'));
        }

        const connectionString = parseCosmosDBConnectionString(`AccountEndpoint=${accountEndpoint}`);

        let tenantId: string | undefined;
        let masterKey: string | undefined;

        if (credentialType === 'MIRRORED_KEY') {
            // Since probably we don't know does Fabric store KEY somewhere or not
            // Use quickInput for manual tenant entry when no tenants are available
            const KEY = await vscode.window.showInputBox({
                prompt: l10n.t('Enter a master key'),
                title: l10n.t('Enter a master key...'),
            });

            if (!KEY || KEY.trim() === '') {
                throw new Error(l10n.t('Master key was not entered. Connection will be interrupted.'));
            }

            masterKey = KEY.trim();
        }

        if (credentialType === 'NATIVE' || credentialType === 'MIRRORED_AAD') {
            // FIXME: using private service
            tenantId =
                // @ts-expect-error Using private method
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
                ((await ext.fabricServices.apiClient.auth.getCurrentTenant())?.tenantId as string) || undefined;
        }

        const credentials = await getCosmosDBCredentials({
            accountName: connectionString.accountName,
            documentEndpoint: connectionString.documentEndpoint,
            isEmulator: false,
            tenantId,
            masterKey,
        });

        return {
            credentials,
            id: artifact.id,
            endpoint: connectionString.documentEndpoint,
            name: connectionString.accountName,
            isEmulator: false,
            isServerless: false,
        };
    }

    protected async getCredentialType(artifact: CosmosDBArtifact): Promise<CosmosDbArtifactType> | never {
        if (!ext.fabricServices) {
            throw new Error(l10n.t('Fabric Service is not initialized'));
        }

        if (artifact.type === 'CosmosDBDatabase') {
            return 'NATIVE';
        }

        // TODO: Fabric web page has internal url to figure out what type of credential it is,
        //  we might need to expose something in Public API to avoid hardcoding the logic here
        if (artifact.type === 'MirroredDatabase') {
            const credentialType: string = 'OAuth2';
            // This code uses internal powerbi API endpoint what requires "user_impersonation" scope
            // const connectionId =
            //     ((artifact.extendedProperties ?? {}) as ExtendedProperties)?.connectionId;
            // const pathTemplate = `/v1/connections/${connectionId}`;
            // const options: IApiClientRequestOptions = {
            //     method: 'GET',
            //     url: 'https://api.powerbi.com',
            //     pathTemplate: pathTemplate,
            //     headers: { 'x-ms-originatingapp': 'vscodefabric' },
            // };
            // const response = await ext.fabricServices.apiClient.sendRequest(options);
            //
            // if (response?.status !== 200) {
            //     throw new Error(
            //         l10n.t(
            //             "Error getting Artifact data for '{0}' Status = {1} {2}",
            //             artifact.displayName,
            //             response.status,
            //             response.response?.bodyAsText ?? '',
            //         ),
            //     );
            // }
            //
            // // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
            // const credentialType = response.parsedBody?.credentialDetails?.credentialType;

            return credentialType === 'Key'
                ? 'MIRRORED_KEY'
                : credentialType === 'OAuth2'
                  ? 'MIRRORED_AAD'
                  : 'MIRRORED_AAD';
        }

        throw new Error(
            l10n.t('Unable to get credential type for artifact type {artifactType}', { artifactType: artifact.type }),
        );
    }

    /**
     * Generates a formatted message for the given error code and message
     * @param operation The operation that was attempted
     * @param response The result of a failed API call
     */
    protected formatErrorResponse(operation: string, response: IApiClientResponse): string {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
        const msg = response.parsedBody?.message ?? response.parsedBody?.errorCode ?? response.status;
        // Only include status in the message if it's not already the fallback
        return typeof msg === 'number' ? `${operation} (${msg})` : `${operation} (${response.status}): ${msg}`;
    }
}

export const FabricService = new FabricServiceImpl();
