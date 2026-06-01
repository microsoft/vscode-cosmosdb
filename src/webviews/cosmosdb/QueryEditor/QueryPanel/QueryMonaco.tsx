/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlLanguageService } from '@cosmosdb/nosql-language-service';
import { registerCosmosDbSql } from '@cosmosdb/nosql-language-service/monaco';
import { useMonaco } from '@monaco-editor/react';
import { useCallback, useEffect, useRef } from 'react';
import { MonacoEditor, type MonacoEditorType } from '../../../MonacoEditor';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

/** Language ID matching the 'nosql' language contributed in package.json. */
const NOSQL_LANGUAGE_ID = 'nosql';

/** Static Monaco editor options — defined outside the component to avoid creating a new object on every render. */
const MONACO_OPTIONS = {
    accessibilitySupport: 'auto' as const,
    accessibilityPageSize: 10,
    fixedOverflowWidgets: true,
};

/**
 * Compute the query block text at the given cursor offset using the
 * language service's multi-query parser. Falls back to the full text
 * when only a single region exists.
 */
function getQueryBlockAtOffset(fullText: string, offset: number, service: SqlLanguageService): string {
    const region = service.getActiveRegion(fullText, offset);
    return region ? region.text.trim() : fullText;
}

export const QueryMonaco = () => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const monaco = useMonaco();

    const disposableRef = useRef<MonacoEditorType.IDisposable | null>(null);
    const cursorDisposableRef = useRef<MonacoEditorType.IDisposable | null>(null);
    const languageServiceDisposableRef = useRef<MonacoEditorType.IDisposable | null>(null);
    const languageServiceRef = useRef<SqlLanguageService | null>(null);
    const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // Keep a ref to the latest schema so the language service always reads fresh data
    const schemaRef = useRef(state.containerSchema);
    useEffect(() => {
        schemaRef.current = state.containerSchema;
    }, [state.containerSchema]);

    // Register the CosmosDB NoSQL language and all providers once Monaco is available
    useEffect(() => {
        if (monaco) {
            // Dispose previous providers if any (e.g., hot reload)
            languageServiceDisposableRef.current?.dispose();

            // Create language service with schema access and register all providers
            // (includes Monarch tokenizer, completions, hover, diagnostics, signature help, formatting)
            const service = new SqlLanguageService({
                getSchema: () => schemaRef.current ?? undefined,
                multiQuery: true,
            });
            languageServiceRef.current = service;

            languageServiceDisposableRef.current = registerCosmosDbSql(monaco, service, {
                languageId: NOSQL_LANGUAGE_ID,
            });
        }

        return () => {
            languageServiceDisposableRef.current?.dispose();
            languageServiceDisposableRef.current = null;
        };
    }, [monaco]);

    const onMount = useCallback(
        (editor: MonacoEditorType.editor.IStandaloneCodeEditor) => {
            // Set up cursor selection event listener
            disposableRef.current = editor.onDidChangeCursorSelection((event) => {
                const selectedContent: string = editor.getModel()?.getValueInRange(event.selection) ?? '';
                dispatcher.setSelectedText(selectedContent);
            });

            // Track cursor position changes to always know which query block the cursor is in.
            // This survives focus loss so the Run button can execute the correct block.
            // Debounced to avoid re-parsing the document on every cursor move.
            cursorDisposableRef.current = editor.onDidChangeCursorPosition((event) => {
                if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
                cursorTimerRef.current = setTimeout(() => {
                    cursorTimerRef.current = undefined;
                    const model = editor.getModel();
                    const service = languageServiceRef.current;
                    if (model && service) {
                        const offset = model.getOffsetAt(event.position);
                        const block = getQueryBlockAtOffset(model.getValue(), offset, service);
                        dispatcher.setCurrentQueryBlock(block);
                    }
                }, 50);
            });

            // Compute the initial query block based on the default cursor position
            {
                const model = editor.getModel();
                const service = languageServiceRef.current;
                if (model && service) {
                    const offset = model.getOffsetAt(editor.getPosition()!);
                    const block = getQueryBlockAtOffset(model.getValue(), offset, service);
                    dispatcher.setCurrentQueryBlock(block);
                }
            }

            // Intercept link clicks inside the Monaco editor (e.g. documentation links in hover tooltips)
            // and route them through the extension host so they open in the default browser.
            const container = editor.getContainerDomNode();
            container.addEventListener('click', (e) => {
                const target = (e.target as HTMLElement).closest('a');
                if (target) {
                    const href = target.getAttribute('href') ?? target.getAttribute('data-href');
                    if (href) {
                        e.preventDefault();
                        e.stopPropagation();
                        void dispatcher.openUrl(href);
                    }
                }
            });
        },
        [dispatcher],
    );

    useEffect(() => {
        // Cleanup on unmount
        return () => {
            disposableRef.current?.dispose();
            cursorDisposableRef.current?.dispose();
            if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
        };
    }, []);

    const onChange = useCallback(
        (newValue: string | undefined) => {
            if (newValue !== undefined && newValue !== state.queryValue) {
                dispatcher.insertText(newValue);
            }
        },
        [dispatcher, state],
    );

    return (
        <MonacoEditor
            height={'100%'}
            width={'100%'}
            language={NOSQL_LANGUAGE_ID}
            value={state.queryValue}
            onChange={onChange}
            onMount={onMount}
            options={MONACO_OPTIONS}
        />
    );
};
