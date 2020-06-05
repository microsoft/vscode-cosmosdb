/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IPostgresProceduresQueryRow {
    schema: string;
    name: string;
    oid: number;
    args: string;
    definition: string;
}
