/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as SingleModels from '@azure/arm-postgresql';
import type * as FlexibleModels from '@azure/arm-postgresql-flexible';

export enum PostgresServerType {
    Flexible = 'Flexible',
    Single = 'Single',
}

export type PostgresAbstractServer = (SingleModels.Server | FlexibleModels.Server) & {
    serverType?: PostgresServerType;
};

export type AbstractFirewallRule = SingleModels.FirewallRule | FlexibleModels.FirewallRule;
