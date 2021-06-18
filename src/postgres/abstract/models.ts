/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
     * The fully qualified domain name of a server.
     */
    fullyQualifiedDomainName?: string;
    /**
     * Server version.
     */
    version?: string;
}

export type PostgresAbstractServerList = Array<PostgresAbstractServer>
