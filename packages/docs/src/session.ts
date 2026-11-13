/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlLanguageService } from '@azure/cosmosdb-nosql-language-service';
import { type JSONSchema } from '@azure/cosmosdb-schema-analyzer';
import { inferSchema } from '../samples/schema';

/** Keep one service while the host replaces its schema or switches editors. */
export function createSession() {
    let schema: JSONSchema | undefined;
    // Read the latest schema on demand, rather than capturing its initial value.
    // multiQuery enables semicolon-separated statements in the same document.
    const service = new SqlLanguageService({
        getSchema: () => schema,
        multiQuery: true,
    });

    return {
        service,
        get schema(): JSONSchema | undefined {
            return schema;
        },
        applyDocuments(documentsJson: string): JSONSchema {
            // Clear first: invalid JSON must not leave stale field suggestions.
            // The UI catches inference errors and explains how to recover.
            schema = undefined;
            schema = inferSchema(documentsJson);
            return schema;
        },
    };
}

export type PlaygroundSession = ReturnType<typeof createSession>;
