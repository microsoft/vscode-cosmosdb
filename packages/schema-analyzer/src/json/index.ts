/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type { NoSQLTypes } from './NoSqlTypes.js';
export { inferNoSqlType, noSqlTypeToDisplayString, noSqlTypeToJSONType } from './NoSqlTypes.js';

export type { NoSQLDocument } from './SchemaAnalyzer.js';
export {
    buildFullPaths,
    getPropertyNamesAtLevel,
    getSchemaFromDocument,
    getSchemaFromDocuments,
    simplifySchema,
    updateSchemaWithDocument,
} from './SchemaAnalyzer.js';

