/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceIdentity } from "@azure/arm-postgresql/esm/models";

export enum PostgresServerType {
    Flexible,
    Single
}

export interface PostgresAbstractServer {
    /**
     * Fully qualified resource ID for the resource. Ex -
     * /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/{resourceProviderNamespace}/{resourceType}/{resourceName}
     * **NOTE: This property will not be serialized. It can only be populated by the server.**
     */
    readonly id?: string;
    /**
     * The name of the resource
     * **NOTE: This property will not be serialized. It can only be populated by the server.**
     */
    readonly name?: string;
    /**
     * The type of the resource. E.g. "Microsoft.Compute/virtualMachines" or
     * "Microsoft.Storage/storageAccounts"
     * **NOTE: This property will not be serialized. It can only be populated by the server.**
     */
    readonly type?: string;
    /**
     * Resource tags.
     */
    tags?: { [propertyName: string]: string };
    /**
     * The geo-location where the resource lives
     */
    location: string;
    /**
     * The fully qualified domain name of a server.
     */
    fullyQualifiedDomainName?: string;
    /**
     * Server version.
     */
    version?: string;
    /**
     * Azure Service type.
     */
    serverType: PostgresServerType;
    /**
     * The Azure Active Directory identity of the server.
     */
    identity?: ResourceIdentity;
}

export type PostgresAbstractServerList = Array<PostgresAbstractServer>;

export interface PostgresAbstractDatabase {
    /**
     * Fully qualified resource ID for the resource. Ex -
     * /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/{resourceProviderNamespace}/{resourceType}/{resourceName}
     * **NOTE: This property will not be serialized. It can only be populated by the server.**
     */
     readonly id?: string;
     /**
      * The name of the resource
      * **NOTE: This property will not be serialized. It can only be populated by the server.**
      */
     readonly name?: string;
}

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
    tier?: string;
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

export interface AbstractNameAvailability {
    /**
     * Error Message.
     */
    message?: string;
    /**
    * Indicates whether the resource name is available.
    */
    nameAvailable?: boolean;
    /**
    * Reason for name being unavailable.
    */
    reason?: string;
}

export interface AbstractFirewallRule {
    /**
     * The start IP address of the server firewall rule. Must be IPv4 format.
     */
    startIpAddress: string;
    /**
     * The end IP address of the server firewall rule. Must be IPv4 format.
     */
    endIpAddress: string;
}
