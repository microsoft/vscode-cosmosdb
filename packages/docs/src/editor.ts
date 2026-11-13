/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type SqlLanguageService } from '@azure/cosmosdb-nosql-language-service';

export interface EditorOptions {
    container: HTMLElement;
    service: SqlLanguageService;
    query: string;
    dark: boolean;
    onChange(query: string): void;
}

export interface PlaygroundEditor {
    setQuery(query: string): void;
    refreshSchema(): void;
    setTheme(dark: boolean): void;
    format(): void;
    focus(): void;
    dispose(): void;
}
