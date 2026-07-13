/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ComponentType } from 'react';

/**
 * Lazy registry: each entry is a dynamic-import factory so that opening one
 * webview does not pay the cost of loading the others.
 *
 * - In dev (Vite, no bundling) this avoids a waterfall of hundreds of module
 *   requests for Monaco / Migration that the requested panel does not need.
 * - In prod each view ends up in its own chunk, so e.g. the Document panel
 *   no longer downloads Monaco.
 */
export const WebviewRegistry = {
    cosmosDbAccountOverview: () => import('./cosmosdb/AccountOverview/AccountOverview').then((m) => m.AccountOverview),
    cosmosDbDocument: () => import('./cosmosdb/Document/Document').then((m) => m.Document),
    cosmosDbMigration: () => import('./cosmosdb/Migration/MigrationAssistant').then((m) => m.MigrationAssistant),
    cosmosDbQuery: () => import('./cosmosdb/QueryEditor/QueryEditor').then((m) => m.QueryEditor),
} as const satisfies Record<string, () => Promise<ComponentType>>;
