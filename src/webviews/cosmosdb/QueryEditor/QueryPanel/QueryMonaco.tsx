/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMonaco } from '@monaco-editor/react';
import { useEffect, useMemo, useRef } from 'react';
import { MonacoEditor, type MonacoEditorType } from '../../../MonacoEditor';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';
import { registerNoSqlCompletionProvider } from './nosqlCompletionProvider';
import { registerNoSqlHoverProvider } from './nosqlHoverProvider';
import { NOSQL_LANGUAGE_ID, registerNoSqlLanguage } from './nosqlLanguage';

export const QueryMonaco = () => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const monaco = useMonaco();

    const disposableRef = useRef<MonacoEditorType.IDisposable | null>(null);
    const completionDisposableRef = useRef<MonacoEditorType.IDisposable | null>(null);
    const hoverDisposableRef = useRef<MonacoEditorType.IDisposable | null>(null);

    // Keep a ref to the latest schema so the completion provider always reads fresh data
    const schemaRef = useRef(state.containerSchema);
    useEffect(() => {
        schemaRef.current = state.containerSchema;
    }, [state.containerSchema]);

    // Register the CosmosDB NoSQL language and completion provider once Monaco is available
    useEffect(() => {
        if (monaco) {
            registerNoSqlLanguage(monaco);

            // Dispose previous providers if any (e.g., hot reload)
            completionDisposableRef.current?.dispose();
            completionDisposableRef.current = registerNoSqlCompletionProvider(monaco, () => schemaRef.current);

            hoverDisposableRef.current?.dispose();
            hoverDisposableRef.current = registerNoSqlHoverProvider(monaco, () => schemaRef.current);
        }

        return () => {
            completionDisposableRef.current?.dispose();
            completionDisposableRef.current = null;
            hoverDisposableRef.current?.dispose();
            hoverDisposableRef.current = null;
        };
    }, [monaco]);

    const onMount = (editor: MonacoEditorType.editor.IStandaloneCodeEditor) => {
        // Update initial editor value as monaco editor doesn't update the value after it's mounted. We need to set it manually here.
        dispatcher.insertText(editor.getValue());

        // Set up cursor selection event listener
        disposableRef.current = editor.onDidChangeCursorSelection((event) => {
            const selectedContent: string = editor.getModel()?.getValueInRange(event.selection) ?? '';
            dispatcher.setSelectedText(selectedContent);
        });

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
    };

    useEffect(() => {
        // Cleanup on unmount
        return () => {
            disposableRef.current?.dispose();
        };
    }, []);

    const onChange = useMemo(
        () => (newValue: string) => {
            if (newValue !== state.queryValue) {
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
            options={{
                accessibilitySupport: 'on',
                accessibilityPageSize: 1,
                fixedOverflowWidgets: true,
            }}
        />
    );
};
