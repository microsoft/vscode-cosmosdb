/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type EditorProps } from '@monaco-editor/react';
import { MonacoEditor } from '../../../MonacoEditor';

// eslint-disable-next-line import/no-internal-modules
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';

import debounce from 'lodash.debounce';
import { useEffect, useRef, useState } from 'react';
import './monacoAdaptive.scss';

/**
 * Props for the MonacoEditor component.
 *
 * @typedef {Object} MonacoEditorProps
 *
 * @property {Object} adaptiveHeight - Configuration for adaptive height of the editor.
 * @property {boolean} adaptiveHeight.enabled - Whether adaptive height is enabled.
 * @property {number} adaptiveHeight.minLines - Minimum number of lines for the editor height.
 * @property {number} adaptiveHeight.maxLines - Maximum number of lines for the editor height.
 * @property {number} [adaptiveHeight.lineHeight] - Height of each line in pixels (optional).
 * @property {function} adaptiveHeight.onEditorContentHeightChange - Callback function when the editor content height changes.
 *
 * @property {function} [onEditorMount] - Handler for editor mount. Invoked when the editor is mounted.
 *                                        You can use it to access editor instance and get a reference to a function you need (e.g. to get the editor content)
 * @property {function} [onExecuteRequest] - Optional: Invoked when the user presses Ctrl/Cmd + Enter in the editor.
 */
export type MonacoAdaptiveProps = EditorProps & {
    adaptiveHeight?: {
        // Optional
        enabled: boolean; // Whether adaptive height is enabled
        minLines: number; // Minimum number of lines for the editor height
        maxLines: number; // Maximum number of lines for the editor height
        lineHeight?: number; // Height of each line in pixels (optional)
    };
    onExecuteRequest?: (editorContent: string) => void; // Optional: Invoked when the user presses Ctrl/Cmd + Enter in the editor
};

export const MonacoAdaptive = (props: MonacoAdaptiveProps) => {
    const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);

    const [editorHeight, setEditorHeight] = useState<number>(1 * 19); // Initial height
    const [lastLineCount, setLastLineCount] = useState<number>(0);

    // Exclude adaptiveHeight prop and onExecuteRequest prop from being passed to the Monaco editor
    // also, let's exclude onMount as we're adding our own handler and will invoke the provided one
    // once we're done with our setup

    // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
    const { adaptiveHeight, onExecuteRequest, onMount, ...editorProps } = props;

    const handleMonacoEditorMount = (
        editor: monacoEditor.editor.IStandaloneCodeEditor,
        monaco: typeof monacoEditor,
    ) => {
        // Store the editor instance in ref
        editorRef.current = editor;

        handleResize();

        if (adaptiveHeight?.enabled) {
            setupAdaptiveHeight(editor);
        }

        // Register a command for Ctrl + Enter / Cmd + Enter
        if (props.onExecuteRequest) {
            editor.addCommand(monacoEditor.KeyMod.CtrlCmd | monacoEditor.KeyCode.Enter, () => {
                // This function will be triggered when Ctrl+Enter or Cmd+Enter is pressed
                props.onExecuteRequest?.(editor.getValue());
            });
        }

        // // If the parent has provided the onMount handler, call it now
        if (onMount) {
            onMount(editor, monaco); // Pass the editor instance to the parent
        }
    };

    useEffect(() => {
        // Add the debounced resize event listener
        const debouncedResizeHandler = debounce(handleResize, 100);
        window.addEventListener('resize', debouncedResizeHandler);

        // Initial layout adjustment
        handleResize();

        // Clean up on component unmount
        return () => {
            if (editorRef.current) {
                editorRef.current.dispose();
            }
            window.removeEventListener('resize', debouncedResizeHandler);
        };
    }, []);

    const handleResize = () => {
        if (editorRef.current) {
            editorRef.current.layout();
        }
    };

    //Helper function to set up adaptive height behavior
    const setupAdaptiveHeight = (editor: monacoEditor.editor.IStandaloneCodeEditor) => {
        // Update the height initially and on content changes
        // const updateHeight = debounce(() => updateEditorHeight(editor), 300); // doesn't really look good, but let's revisit it later
        const updateHeight = () => updateEditorHeight(editor);

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

        // Only update if the number of lines changes
        if (lineCount !== lastLineCount) {
            const lines = Math.min(lineCount, maxLines);
            const finalLines = Math.max(lines, minLines);

            const finalHeight = finalLines * lineHeight;

            // Call the callback if provided
            setEditorHeight(finalHeight);

            // TODO: once allotment is implemented, we can remove this hack:

            // this is a hack to fix the issue with the editor not updating the layout properly
            // the first run computes the correct width. The second run applies the height we need
            editor.layout();
            // Update the editor layout with the new height
            editor.layout({ width: editor.getLayoutInfo().width, height: finalHeight });

            // Save the last line count to avoid unnecessary updates
            setLastLineCount(lineCount);
        }
    };

    return (
        <div className="monacoAdaptiveContainer" style={{ height: editorHeight }}>
            <MonacoEditor {...editorProps} onMount={handleMonacoEditorMount} />
        </div>
    );
};
