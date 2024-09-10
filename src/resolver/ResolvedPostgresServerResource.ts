/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzExtTreeItem, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AppResource, type ResolvedAppResourceBase } from '@microsoft/vscode-azext-utils/hostapi';
import { type ClientConfig } from 'pg';
import { type PostgresServerType } from '../postgres/abstract/models';
import { type ParsedPostgresConnectionString } from '../postgres/postgresConnectionStrings';
import { type PostgresServerTreeItem } from '../postgres/tree/PostgresServerTreeItem';
import { ResolvedDatabaseAccountResource } from './ResolvedDatabaseAccountResource';

export class ResolvedPostgresServerResource extends ResolvedDatabaseAccountResource implements ResolvedAppResourceBase {
    public readonly serverType?: PostgresServerType;

    public resourceGroup: string | undefined;
    public azureName: string | undefined;
    public partialConnectionString: ParsedPostgresConnectionString;

    public azureId: string | undefined;
    public serverVersion: string | undefined;

    setCredentials: (username: string, password: string) => void;
    supportsStoredProcedures: (clientConfig: ClientConfig) => Promise<boolean>;
    deletePostgresCredentials: () => Promise<void>;
    getFullConnectionString: () => Promise<ParsedPostgresConnectionString>;
    validateDatabaseName: (
        name: string,
        getChildrenTask: Promise<AzExtTreeItem[]>,
    ) => Promise<string | undefined | null>;
    isFirewallRuleSet: (context: IActionContext) => Promise<boolean>;

    public constructor(ti: PostgresServerTreeItem, resource: AppResource) {
        super(ti, resource);
        this.serverType = ti.serverType;
        this.description = ti.description;
        this.resourceGroup = ti.resourceGroup;
        this.azureName = ti.azureName;
        this.partialConnectionString = ti.partialConnectionString;

        this.azureId = ti.azureId;
        this.serverVersion = ti.serverVersion;

        this.setCredentials = ti.setCredentials;
        this.supportsStoredProcedures = ti.supportsStoredProcedures;
        this.deletePostgresCredentials = ti.deletePostgresCredentials;
        this.getFullConnectionString = ti.getFullConnectionString;
        this.isFirewallRuleSet = ti.isFirewallRuleSet;
    }
}
