/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Editor, { loader, useMonaco, type EditorProps } from '@monaco-editor/react';
// eslint-disable-next-line import/no-internal-modules
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { useEffect, useState } from 'react';
import { useThemeState } from './theme/state/ThemeContext';

loader.config({ monaco: monacoEditor });

export type MonacoEditorProps = EditorProps & {
    adaptiveHeight?: { // Optional
        enabled: boolean; // Whether adaptive height is enabled
        minLines: number; // Minimum number of lines for the editor height
        maxLines: number; // Maximum number of lines for the editor height
        lineHeight?: number; // Height of each line in pixels (optional)
        onEditorContentHeightChange: (height: number) => void; // Callback function when the editor content height changes
    };
    onExecute?: (value: string) => void; // Optional: Invoked when the user presses Ctrl/Cmd + Enter in the editor
};

export const MonacoEditor = (props: MonacoEditorProps) => {
    const monaco = useMonaco();
    const themeState = useThemeState();

    const [lastLineCount, setLastLineCount] = useState<number>(0);

    // Exclude adaptiveHeight prop from being passed to the Monaco editor
    const { adaptiveHeight, ...editorProps } = props;

    useEffect(() => {
        if (monaco) {
            if (themeState.monaco.theme) {
                monaco.editor.defineTheme(themeState.monaco.themeName, themeState.monaco.theme);
                monaco.editor.setTheme(themeState.monaco.themeName);
            }
        }
    }, [monaco, themeState]);

    // Handle editor mount and apply adaptive height if enabled
    const handleEditorDidMount = (editor: monacoEditor.editor.IStandaloneCodeEditor) => {
        if (adaptiveHeight?.enabled) {
            console.log('adaptiveHeight enabled', adaptiveHeight);

            setupAdaptiveHeight(editor);
        }

        // Register a command for Ctrl + Enter / Cmd + Enter
        if (props.onExecute) {
            editor.addCommand(monacoEditor.KeyMod.CtrlCmd | monacoEditor.KeyCode.Enter, () => {
                // This function will be triggered when Ctrl+Enter or Cmd+Enter is pressed
                props.onExecute?.(editor.getValue());
            });
        }
    };

    // Helper function to set up adaptive height behavior
    const setupAdaptiveHeight = (editor: monacoEditor.editor.IStandaloneCodeEditor) => {
        // Update the height initially and on content changes
        const updateHeight = () =>
            // useCallback(
            //     debounce((editor: monacoEditor.editor.IStandaloneCodeEditor) => {
            updateEditorHeight(editor);
        //     }, 500),
        //     [],
        // );

        updateHeight();

        // Attach event listener for content changes
        editor.onDidChangeModelContent(updateHeight);
    };

    // Update the editor height based on the number of lines in the document
    const updateEditorHeight = (editor: monacoEditor.editor.IStandaloneCodeEditor) => {
        // Safely access adaptiveHeight properties with defaults
        const lineHeight = adaptiveHeight?.lineHeight ?? 19;
        const minLines = adaptiveHeight?.minLines ?? 1;
        const maxLines = adaptiveHeight?.maxLines ?? 10;

        const lineCount = editor.getModel()?.getLineCount() || 1;

        console.log('linecount internal: ' + lineCount);

        // Only update if the number of lines changes
        if (lineCount !== lastLineCount) {
            const lines = Math.min(lineCount, maxLines);
            const finalLines = Math.max(lines, minLines);

            const finalHeight = finalLines * lineHeight;
            console.log('finalHeight internal: ' + finalHeight);

            // Call the callback if provided
            adaptiveHeight?.onEditorContentHeightChange?.(finalHeight);

            // Update the editor layout with the new height
            editor.layout({ width: editor.getLayoutInfo().width, height: finalHeight });

            // Save the last line count to avoid unnecessary updates
            setLastLineCount(lineCount);
        }
    };

    return <Editor {...editorProps} theme={themeState.monaco.themeName} onMount={handleEditorDidMount} />;
};
