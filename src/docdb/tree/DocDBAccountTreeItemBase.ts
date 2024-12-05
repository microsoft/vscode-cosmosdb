/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb/src/models';
import {
    type CosmosClient,
    type DatabaseDefinition,
    type DatabaseResponse,
    type FeedOptions,
    type QueryIterator,
    type Resource,
} from '@azure/cosmos';
import {
    callWithTelemetryAndErrorHandling,
    type AzExtParentTreeItem,
    type AzExtTreeItem,
    type IActionContext,
    type ICreateChildImplContext,
} from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';
import { API } from '../../AzureDBExperiences';
import { type IDeleteWizardContext } from '../../commands/deleteDatabaseAccount/IDeleteWizardContext';
import { deleteCosmosDBAccount } from '../../commands/deleteDatabaseAccount/deleteCosmosDBAccount';
import { getThemeAgnosticIconPath, SERVERLESS_CAPABILITY_NAME } from '../../constants';
import { nonNullProp } from '../../utils/nonNull';
import { rejectOnTimeout } from '../../utils/timeout';
import { getCosmosClient, getCosmosKeyCredential, type CosmosDBCredential } from '../getCosmosClient';
import { getSignedInPrincipalIdForAccountEndpoint } from '../utils/azureSessionHelper';
import { ensureRbacPermission, isRbacException, showRbacPermissionError } from '../utils/rbacUtils';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';

/**
 * This class provides common logic for DocumentDB, Graph, and Table accounts
 * (DocumentDB is the base type for all Cosmos DB accounts)
 */
export abstract class DocDBAccountTreeItemBase extends DocDBTreeItemBase<DatabaseDefinition & Resource> {
    public readonly label: string;
    public readonly childTypeLabel: string = 'Database';
    private hasShownRbacNotification: boolean = false;

    constructor(
        parent: AzExtParentTreeItem,
        id: string,
        label: string,
        endpoint: string,
        credentials: CosmosDBCredential[],
        isEmulator: boolean | undefined,
        readonly databaseAccount?: DatabaseAccountGetResults,
    ) {
        super(parent);
        this.id = id;
        this.label = label;
        this.root = {
            endpoint,
            credentials,
            isEmulator,
            getCosmosClient: () => getCosmosClient(endpoint, credentials, isEmulator),
        };

        const keys = credentials
            .map((cred) => (cred.type === 'key' ? cred.key : undefined))
            .filter((value): value is string => value !== undefined);
        this.valuesToMask.push(id, endpoint, ...keys);
    }

    public get connectionString(): string {
        const firstKey = getCosmosKeyCredential(this.root.credentials);
        if (firstKey) {
            return `AccountEndpoint=${this.root.endpoint};AccountKey=${firstKey.key}`;
        } else {
            return `AccountEndpoint=${this.root.endpoint}`;
        }
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('CosmosDBAccount.svg');
    }

    public get isServerless(): boolean {
        return this.databaseAccount?.capabilities
            ? this.databaseAccount.capabilities.some((cap) => cap.name === SERVERLESS_CAPABILITY_NAME)
            : false;
    }

    public getIterator(client: CosmosClient, feedOptions: FeedOptions): QueryIterator<DatabaseDefinition & Resource> {
        return client.databases.readAll(feedOptions);
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<AzExtTreeItem> {
        const databaseName = await context.ui.showInputBox({
            placeHolder: 'Database Name',
            validateInput: validateDatabaseName,
            stepName: 'createDatabase',
        });

        const client = this.root.getCosmosClient();
        const database: DatabaseResponse = await client.databases.create({ id: databaseName });
        return this.initChild(nonNullProp(database, 'resource'));
    }

    public async loadMoreChildrenImpl(clearCache: boolean): Promise<AzExtTreeItem[]> {
        const result = await callWithTelemetryAndErrorHandling(
            'getChildren',
            async (context: IActionContext): Promise<AzExtTreeItem[]> => {
                context.telemetry.properties.parentNodeContext = this.contextValue;

                // move this to a shared file, currently it's defined in DocDBAccountTreeItem so I can't reference it here
                if (this.contextValue.includes('cosmosDBDocumentServer')) {
                    context.telemetry.properties.experience = API.Core;
                    // same issue as above
                } else if (this.contextValue.includes('cosmosDBGraphAccount')) {
                    context.telemetry.properties.experience = API.Graph;
                    // same issue as above
                } else if (this.contextValue.includes('cosmosDBTableAccount')) {
                    context.telemetry.properties.experience = API.Table;
                }

                if (this.root.isEmulator) {
                    const unableToReachEmulatorMessage: string =
                        "Unable to reach emulator. Please ensure it is started and connected to the port specified by the 'cosmosDB.emulator.port' setting, then try again.";
                    return await rejectOnTimeout(
                        2000,
                        () => super.loadMoreChildrenImpl(clearCache),
                        unableToReachEmulatorMessage,
                    );
                } else {
                    try {
                        return await super.loadMoreChildrenImpl(clearCache);
                    } catch (e) {
                        if (e instanceof Error && isRbacException(e) && !this.hasShownRbacNotification) {
                            this.hasShownRbacNotification = true;
                            const principalId =
                                (await getSignedInPrincipalIdForAccountEndpoint(this.root.endpoint)) ?? '';
                            // chedck if the principal ID matches the one that is signed in, otherwise this might be a security problem, hence show the error message
                            if (
                                e.message.includes(`[${principalId}]`) &&
                                (await ensureRbacPermission(this, principalId))
                            ) {
                                return await super.loadMoreChildrenImpl(clearCache);
                            } else {
                                void showRbacPermissionError(this.fullId, principalId);
                            }
                        }
                        throw e; // rethrowing tells the resources extension to show the exception message in the tree
                    }
                }
            },
        );

        return result ?? [];
    }

    public async deleteTreeItemImpl(context: IDeleteWizardContext): Promise<void> {
        await deleteCosmosDBAccount(context, this);
    }
}

function validateDatabaseName(name: string): string | undefined | null {
    if (!name || name.length < 1 || name.length > 255) {
        return 'Name has to be between 1 and 255 chars long';
    }
    if (name.endsWith(' ')) {
        return 'Database name cannot end with space';
    }
    if (/[/\\?#=]/.test(name)) {
        return `Database name cannot contain the characters '\\', '/', '#', '?', '='`;
    }
    return undefined;
}
