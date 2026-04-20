/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Document } from '../../cosmosdb/Document/Document';
import { MigrationAssistant } from '../../cosmosdb/Migration/MigrationAssistant';
import { QueryEditor } from '../../cosmosdb/QueryEditor/QueryEditor';

export const WebviewRegistry = {
    cosmosDbDocument: Document,
    cosmosDbQuery: QueryEditor,
    cosmosDbMigration: MigrationAssistant,
} as const;
