/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONSchema } from '@cosmosdb/schema-analyzer';

/** Re-export for consumers that import from this module */
export type { JSONSchema };

export type CompletionItemKind = 'keyword' | 'field' | 'function' | 'snippet' | 'parameter' | 'alias';

export interface CompletionItem {
    label: string;
    kind: CompletionItemKind;
    detail?: string;
    sortText?: string;
    insertText?: string;
}

export interface CompletionRequest {
    /** The full query string (maybe incomplete / invalid) */
    query: string;
    /** 0-based cursor offset in the query string */
    offset: number;
    /** JSON Schema of the collection (with x-extensions) */
    schema?: JSONSchema;
    /** Known collection aliases from `FROM` clause (e.g. ["c", "t"]) — auto-detected if not provided */
    aliases?: string[];
}

