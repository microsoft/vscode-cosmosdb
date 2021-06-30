/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as FlexibleModels from "@azure/arm-postgresql-flexible/esm/models";
import * as SingleModels from "@azure/arm-postgresql/esm/models";

export enum PostgresServerType {
    Flexible,
    Single
}

export type PostgresAbstractServer = (SingleModels.Server | FlexibleModels.Server) & { serverType?: PostgresServerType; }

export type PostgresAbstractServerList = Array<PostgresAbstractServer>;

export type PostgresAbstractDatabase = SingleModels.Database | FlexibleModels.Database;

export type PostgresAbstractDatabaseList = Array<PostgresAbstractDatabase>;

/**
 * Billing information related properties of a server.
 */
 export interface AbstractSku {
    /**
     * The name of the sku, typically, tier + family + cores, e.g. B_Gen4_1, GP_Gen5_8.
     */
    name: string;
    /**
     * The tier of the particular SKU, e.g. Basic. Possible values include: 'Basic',
     * 'GeneralPurpose', 'MemoryOptimized'
     */
    tier?: SingleModels.SkuTier | FlexibleModels.SkuTier;
    /**
     * The scale up/out capacity, representing server's compute units.
     */
    capacity?: number;
    /**
     * The size code, to be interpreted by resource as appropriate.
     */
    size?: string;
    /**
     * The family of hardware.
     */
    family?: string;
}

export interface AbstractServerCreate {
    location: string;
    sku: AbstractSku;
    administratorLogin: string;
    administratorLoginPassword: string;
    version: string;
    storageMB: number;
}

export type AbstractNameAvailability = SingleModels.NameAvailability | FlexibleModels.NameAvailability;

export type AbstractFirewallRule = SingleModels.FirewallRule | FlexibleModels.FirewallRule;
