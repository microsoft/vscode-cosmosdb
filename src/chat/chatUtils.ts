/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type QueryEditorTab } from '../panels/QueryEditorTab';

/**
 * Find the active or visible query editor, fallback to first if none active
 */
export const getActiveQueryEditor = (activeQueryEditors: QueryEditorTab[]): QueryEditorTab =>
    activeQueryEditors.find((editor) => editor.isActive()) ||
    activeQueryEditors.find((editor) => editor.isVisible()) ||
    activeQueryEditors[0];

/**
 * Helper method to get connection from a query editor tab
 */
export const getConnectionFromQueryTab = (queryTab: QueryEditorTab): NoSqlQueryConnection | undefined => {
    return queryTab.getConnection();
};
