/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type IApiClientRequestOptions,
    type IApiClientResponse,
    type IArtifact,
    type IArtifactHandler,
    type IWorkspace,
} from '@microsoft/vscode-fabric-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type FabricArtifactType } from '../constants';
import { parseCosmosDBConnectionString } from '../cosmosdb/cosmosDBConnectionStrings';
import { getCosmosDBCredentials } from '../cosmosdb/CosmosDBCredential';
import { ext } from '../extensionVariables';
import { type AccountInfo } from '../tree/cosmosdb/AccountInfo';
import { type CosmosDbSourceInfo, getArtifactPath, parseCosmosDbSourceProperties } from './FabricServiceUtils';

export const CosmosDbArtifactType = ['NATIVE', 'MIRRORED_KEY', 'MIRRORED_AAD'] as const;
export type CosmosDbArtifactType = (typeof CosmosDbArtifactType)[number];

export type ExtendedProperties = {
    serverFqdn?: string;
    databaseName?: string;
    connectionId?: string;
    resourceTokens?: Record<string, string>;
    cosmosDbSourceProperties?: {
        serverFqdn?: string;
        databaseName?: string;
        credentialType?: string;
    };
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

        const fullArtifact = await this.getFullArtifact(artifact);

        const extendedProperties = (fullArtifact.properties ?? {}) as ExtendedProperties;
        let mirroredSourceProperties: CosmosDbSourceInfo | undefined;
        if (artifact.type === 'MirroredDatabase') {
            try {
                mirroredSourceProperties = parseCosmosDbSourceProperties(extendedProperties);
            } catch (error) {
                throw new Error(
                    l10n.t(
                        'Unable to read the mirrored database connection information: {0}',
                        this.getErrorMessage(error),
                    ),
                );
            }
        }

        const credentialType = this.getCredentialType(artifact, mirroredSourceProperties?.credentialType);
        const accountEndpoint = mirroredSourceProperties?.accountEndpoint ?? `${extendedProperties.serverFqdn ?? ''}`;
        const databaseName = mirroredSourceProperties?.databaseName ?? `${extendedProperties.databaseName ?? ''}`;
        const connectionId = extendedProperties.connectionId;
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

        const response = await this.getArtifact(artifact);
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

    protected getArtifact(artifact: CosmosDBArtifact): Promise<IApiClientResponse> {
        if (!ext.fabricServices) {
            throw new Error(l10n.t('Fabric Service is not initialized'));
        }

        // If the handler has a readWorkflow with onBeforeRead, call it before sending the request
        const pathTemplate = getArtifactPath(artifact.workspaceId, artifact.id, artifact.type);

        const options: IApiClientRequestOptions = {
            method: 'GET',
            pathTemplate: pathTemplate,
        };

        return ext.fabricServices.apiClient.sendRequest(options);
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
                // oxlint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
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

    protected getCredentialType(artifact: CosmosDBArtifact, credentialType?: string): CosmosDbArtifactType | never {
        if (!ext.fabricServices) {
            throw new Error(l10n.t('Fabric Service is not initialized'));
        }

        if (artifact.type === 'CosmosDBDatabase') {
            return 'NATIVE';
        }

        if (artifact.type === 'MirroredDatabase') {
            if (credentialType === 'Key') {
                return 'MIRRORED_KEY';
            }
            if (credentialType === 'OAuth2') {
                return 'MIRRORED_AAD';
            }

            throw new Error(
                l10n.t('Unsupported credential type for mirrored database: {0}', credentialType ?? 'unknown'),
            );
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
        // oxlint-disable-next-line typescript/no-unsafe-assignment, typescript/no-unsafe-member-access
        const msg = response.parsedBody?.message ?? response.parsedBody?.errorCode ?? response.status;
        // Only include status in the message if it's not already the fallback
        return typeof msg === 'number' ? `${operation} (${msg})` : `${operation} (${response.status}): ${msg}`;
    }

    private getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}

export const FabricService = new FabricServiceImpl();
