/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Side-effect import: pulls in ALL editor contributions (suggest controller,
// hover widget, find/replace, folding, link detector, etc.) AND all basic
// languages (JSON/CSS/HTML/TS Monarch tokenizers + language services).
//
// Without this, `editor.api` below would give a HEADLESS editor — no suggest
// widget, no hover widget — and even though language providers register
// correctly, Monaco never invokes them because there is nothing to consume
// them. UI commands like `editor.action.triggerSuggest` would not exist
// (you would see: `Error: command 'editor.action.triggerSuggest' not found`).
//
// This is what `monaco-editor-webpack-plugin` arranges automatically via its
// `features`/`languages` options. With Vite we have to import it ourselves.
import 'monaco-editor/esm/vs/editor/editor.main';
import { useUncontrolledFocus } from '@fluentui/react-components';
import Editor, { loader, useMonaco, type EditorProps, type OnMount } from '@monaco-editor/react';
// Type-only handle to the Monaco API (no `.d.ts` is published for
// `editor.main`, but `editor.api` re-exports the same singleton namespace).
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useThemeState } from './theme/state/ThemeContext';
export type * as MonacoEditorType from 'monaco-editor/esm/vs/editor/editor.api';

loader.config({ monaco: monacoEditor });

/**
 * Container style for the editor wrapper section. Defined at module scope so
 * the same object reference is reused across renders (avoids
 * `jsx-no-new-object-as-prop`).
 */
const CONTAINER_STYLE: React.CSSProperties = { width: '100%', height: '100%' };

/**
 * Style for the invisible focus-trap-bumper element. See FluentUI's tabster
 * source linked below for why this odd 1×1 fixed element is required.
 */
const FOCUS_TRAP_BUMPER_STYLE: React.CSSProperties = {
    position: 'fixed',
    height: '1px',
    width: '1px',
    opacity: '0.001',
    zIndex: '-1',
    contentVisibility: 'hidden',
    top: '0px',
    left: '0px',
};

/**
 * Custom resize observer for Monaco Editor that defers `editor.layout()` to the
 * next animation frame. This avoids the "ResizeObserver loop completed with
 * undelivered notifications" error caused by Monaco's built-in `ElementSizeObserver`,
 * which synchronously mutates the DOM inside the ResizeObserver callback,
 * creating a feedback loop the browser must break.
 */
function useEditorResizeObserver(containerRef: React.RefObject<HTMLElement | null>) {
    const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);
    const rafIdRef = useRef<number | null>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver(() => {
            // Cancel any pending layout call — only the latest resize matters
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
            }
            // Defer layout to the next frame so the ResizeObserver callback
            // finishes without synchronous DOM mutations, breaking the loop.
            rafIdRef.current = requestAnimationFrame(() => {
                rafIdRef.current = null;
                editorRef.current?.layout();
            });
        });

        observer.observe(container);

        return () => {
            observer.disconnect();
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
        };
    }, [containerRef]);

    return editorRef;
}

export const MonacoEditor = (props: EditorProps) => {
    const monaco = useMonaco();
    const themeState = useThemeState();
    const uncontrolledFocus = useUncontrolledFocus();
    const containerRef = useRef<HTMLElement | null>(null);
    const editorRef = useEditorResizeObserver(containerRef);

    useEffect(() => {
        if (monaco) {
            if (themeState.monaco.theme) {
                monaco.editor.defineTheme(themeState.monaco.themeName, themeState.monaco.theme);
                monaco.editor.setTheme(themeState.monaco.themeName);
            }
        }
    }, [monaco, themeState]);

    // Merge our onMount with the caller's onMount so we can capture the editor instance
    const callerOnMount = props.onMount;
    const handleMount: OnMount = useCallback(
        (editor, monacoInstance) => {
            editorRef.current = editor;
            // Force an initial layout so the editor picks up the container's
            // current dimensions. The ResizeObserver may have already fired
            // before the editor was created, leaving it at a minimal size.
            editor.layout();
            callerOnMount?.(editor, monacoInstance);
        },
        [callerOnMount, editorRef],
    );

    // Disable Monaco's built-in automaticLayout to prevent the ResizeObserver loop;
    // our custom observer above handles resizing instead.
    const options = useMemo(() => ({ ...props.options, automaticLayout: false }), [props.options]);

    return (
        <section ref={containerRef} {...uncontrolledFocus} style={CONTAINER_STYLE}>
            <i
                // The hack to make the focus trap work
                // https://github.com/microsoft/fluentui/blob/0f490a4fea60df6b2ad0f5a6e088017df7ce1d54/packages/react-components/react-tabster/src/hooks/useTabster.ts#L34
                data-is-focus-trap-zone-bumper={true}
                style={FOCUS_TRAP_BUMPER_STYLE}
            ></i>
            <Editor
                {...props}
                options={options}
                onMount={handleMount}
                data-is-focus-trap-zone-bumper={true}
                theme={themeState.monaco.themeName}
            />
        </section>
    );
};
