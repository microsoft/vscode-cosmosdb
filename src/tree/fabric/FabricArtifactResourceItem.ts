/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosClient } from '@azure/cosmos';
import type vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getThemeAgnosticIconPath } from '../../constants';
import { AuthenticationMethod } from '../../cosmosdb/AuthenticationMethod';
import { getCosmosDBEntraIdCredential } from '../../cosmosdb/CosmosDBCredential';
import { getSignedInPrincipalIdForAccountEndpoint } from '../../cosmosdb/utils/azureSessionHelper';
import { isRbacException, showRbacPermissionError } from '../../cosmosdb/utils/rbacUtils';
import { withClaimsChallengeHandling } from '../../cosmosdb/withClaimsChallengeHandling';
import { ext } from '../../extensionVariables';
import { FabricService, type ArtifactConnectionInfo } from '../../services/FabricService';
import { CosmosDBAccountResourceItemBase } from '../azure-resources-view/cosmosdb/CosmosDBAccountResourceItemBase';
import { type AccountInfo } from '../cosmosdb/AccountInfo';
import { type DatabaseResource } from '../cosmosdb/models/CosmosDBTypes';
import { type TreeElement } from '../TreeElement';
import { type FabricArtifact } from './models/FabricArtifact';

/**
 * Artifact tree node represents a Database in Cosmos DB hierarchy.
 */
export abstract class FabricArtifactResourceItem extends CosmosDBAccountResourceItemBase {
    declare public readonly account: FabricArtifact;

    // To prevent the RBAC notification from showing up multiple times
    protected hasShownRbacNotification: boolean = false;

    protected constructor(
        public readonly context: vscode.ExtensionContext,
        public readonly artifact: FabricArtifact,
        experience: Experience,
    ) {
        super(artifact, experience);
    }

    public async getChildren(): Promise<TreeElement[]> {
        const artifactConnectionInfo = await FabricService.getArtifactConnectionInfo(this.artifact);
        const accountInfo = artifactConnectionInfo.accountInfo;

        const databases = await withClaimsChallengeHandling(accountInfo, async (cosmosClient) =>
            this.getDatabases(artifactConnectionInfo, cosmosClient),
        );
        const sortedDatabases = databases.sort((a, b) => a.id.localeCompare(b.id));

        return this.getChildrenImpl(accountInfo, artifactConnectionInfo, sortedDatabases);
    }

    public getTreeItem(): vscode.TreeItem {
        return { ...super.getTreeItem(), iconPath: getThemeAgnosticIconPath('CosmosDBAccount.svg') };
    }

    public async getConnectionString(): Promise<string | undefined> {
        const artifactConnectionInfo = await FabricService.getArtifactConnectionInfo(this.artifact);
        const accountInfo = artifactConnectionInfo.accountInfo;
        const keyCred = accountInfo.credentials.find((cred) => cred.type === AuthenticationMethod.accountKey);

        const parts = [`AccountEndpoint=${accountInfo.endpoint}`];

        if (keyCred) {
            parts.push(`AccountKey=${keyCred.key}`);
        }

        if (artifactConnectionInfo.databaseName) {
            parts.push(`Database=${artifactConnectionInfo.databaseName}`);
        }

        return parts.join(';');
    }

    protected async getDatabases(
        artifactConnectionInfo: ArtifactConnectionInfo,
        cosmosClient: CosmosClient,
    ): Promise<DatabaseResource[]> | never {
        try {
            // Await is required here to ensure that the error is caught in the catch block
            return await this.getResources(artifactConnectionInfo, cosmosClient);
        } catch (e) {
            if (e instanceof Error && isRbacException(e) && !this.hasShownRbacNotification) {
                this.hasShownRbacNotification = true;

                const accountInfo = artifactConnectionInfo.accountInfo;
                const tenantId = getCosmosDBEntraIdCredential(accountInfo.credentials)?.tenantId;
                const principalId = await getSignedInPrincipalIdForAccountEndpoint(accountInfo.endpoint, tenantId);

                // Since we don't have subscription, everything what we can do - show RBAC error
                void showRbacPermissionError(this.id, principalId);
                ext.outputChannel.error(e);
                ext.outputChannel.show();
            }
            throw e; // rethrowing tells the resources extension to show the exception message in the tree
        }
    }

    protected abstract getResources(
        artifactConnectionInfo: ArtifactConnectionInfo,
        cosmosClient: CosmosClient,
    ): Promise<DatabaseResource[]> | never;

    protected abstract getChildrenImpl(
        accountInfo: AccountInfo,
        artifactConnectionInfo: ArtifactConnectionInfo,
        databases: DatabaseResource[],
    ): Promise<TreeElement[]>;
}
