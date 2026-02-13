/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useRef } from 'react';
import { MonacoEditor, type MonacoEditorType } from '../../../MonacoEditor';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const QueryMonaco = () => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const disposableRef = useRef<MonacoEditorType.IDisposable | null>(null);

    const onMount = (editor: MonacoEditorType.editor.IStandaloneCodeEditor) => {
        // Update initial editor value as monaco editor doesn't update the value after it's mounted. We need to set it manually here.
        dispatcher.insertText(editor.getValue());

        // Set up cursor selection event listener
        disposableRef.current = editor.onDidChangeCursorSelection((event) => {
            const selectedContent: string = editor.getModel()?.getValueInRange(event.selection) ?? '';
            dispatcher.setSelectedText(selectedContent);
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
