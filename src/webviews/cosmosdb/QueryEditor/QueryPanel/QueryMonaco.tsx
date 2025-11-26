/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { MonacoEditor, type MonacoEditorType } from '../../../MonacoEditor';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const QueryMonaco = () => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const editorRef = useRef<MonacoEditorType.editor.IStandaloneCodeEditor | null>(null);

    const cursorSelectionHandler = useCallback(
        (event: MonacoEditorType.editor.ICursorSelectionChangedEvent) => {
            if (!editorRef.current) {
                return;
            }

            const selectedContent: string = editorRef.current.getModel()?.getValueInRange(event.selection) ?? '';
            dispatcher.setSelectedText(selectedContent);
        },
        [dispatcher],
    );

    useEffect(() => {
        if (!editorRef.current) {
            return;
        }

        const disposable = editorRef.current.onDidChangeCursorSelection(cursorSelectionHandler);

        return () => {
            disposable.dispose();
        };
    }, [cursorSelectionHandler]);

    const onMount = (editor: MonacoEditorType.editor.IStandaloneCodeEditor) => {
        // Store the editor instance in ref
        editorRef.current = editor;
    };

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
            language="sql"
            value={state.queryValue}
            onChange={onChange}
            onMount={onMount}
            options={{
                accessibilitySupport: 'on',
                accessibilityPageSize: 1,
            }}
        />
    );
};
