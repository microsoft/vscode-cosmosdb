/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// #region example
import {
    cosmosDbSqlStreamParser,
    createCompletionSource,
    createFormatCommand,
    createHoverTooltipSource,
    createLintSource,
    createMultiQueryFoldService,
} from '@azure/cosmosdb-nosql-language-service/codemirror';
import {
    autocompletion,
    closeCompletion,
    completionKeymap,
    snippet,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
    defaultHighlightStyle,
    foldGutter,
    foldKeymap,
    foldService,
    HighlightStyle,
    StreamLanguage,
    syntaxHighlighting,
} from '@codemirror/language';
import { linter, lintGutter, setDiagnostics } from '@codemirror/lint';
import { Compartment, EditorState } from '@codemirror/state';
import {
    EditorView,
    hoverTooltip,
    keymap,
    lineNumbers,
} from '@codemirror/view';
import { type EditorOptions, type PlaygroundEditor } from '../src/editor';

// #region codemirror-editor
/**
 * Import dynamically after mounting; EditorView needs a DOM container.
 * Features are composed as extensions, not registered globally.
 */
export function createCodeMirrorEditor(
    options: EditorOptions,
): PlaygroundEditor {
    // A compartment lets us replace only the theme, preserving text,
    // selection, undo history, and all language extensions.
    const theme = new Compartment();
    // Factories adapt our editor-independent service to CodeMirror APIs.
    // They do not enable features until installed in extensions below.
    const lint = createLintSource(options.service);
    const format = createFormatCommand(options.service);
    const complete = createCompletionSource(options.service);
    const view = new EditorView({
        parent: options.container,
        state: EditorState.create({
            doc: options.query,
            extensions: [
                lineNumbers(),
                history(),
                // The stream parser recognizes SQL tokens; HighlightStyle
                // controls their appearance using the host's CSS variables.
                StreamLanguage.define(cosmosDbSqlStreamParser),
                syntaxHighlighting(
                    HighlightStyle.define(
                        defaultHighlightStyle.specs.map((style) => ({
                            ...style,
                            color: 'var(--cp-accent)',
                        })),
                    ),
                ),
                // Override CodeMirror's sources with schema-aware SQL
                // completions. Field names and types come from the service.
                autocompletion({
                    override: [
                        (context) => {
                            const result = complete(context);
                            if (!result) return null;
                            return {
                                ...result,
                                options: result.options.map((completion) =>
                                    // Version 1.0.0 returns $0 as plain text.
                                    // snippet() turns ${0} into a cursor stop.
                                    completion.type === 'function' &&
                                    typeof completion.apply === 'string'
                                        ? {
                                              ...completion,
                                              apply: snippet(
                                                  completion.apply.replace(
                                                      /\$(\d+)/g,
                                                      '${$1}',
                                                  ),
                                              ),
                                          }
                                        : completion,
                                ),
                            };
                        },
                    ],
                }),
                hoverTooltip(createHoverTooltipSource(options.service)),
                // The linter draws inline markers; lintGutter adds gutter
                // indicators. Delay analysis slightly while the user types.
                linter(lint, { delay: 150 }),
                lintGutter(),
                // Ranges come from the service; CodeMirror supplies controls.
                // Multi-query folding needs multiQuery: true on the service.
                foldGutter(),
                foldService.of(createMultiQueryFoldService(options.service)),
                // Keep completion navigation, normal editing, undo and folding.
                // Leave Tab unbound so users can move focus out of the editor.
                keymap.of([
                    ...completionKeymap,
                    ...defaultKeymap,
                    ...historyKeymap,
                    ...foldKeymap,
                ]),
                EditorView.lineWrapping,
                EditorView.contentAttributes.of({
                    'aria-label': 'Cosmos DB SQL query',
                    'aria-describedby':
                        options.container.getAttribute('aria-describedby') ??
                        '',
                }),
                // Report text changes, not cursor moves or theme changes,
                // so the host can preserve the query when switching editors.
                EditorView.updateListener.of((update) => {
                    if (update.docChanged)
                        options.onChange(update.state.doc.toString());
                }),
                theme.of(editorTheme(options.dark)),
            ],
        }),
    });

    return {
        setQuery(query) {
            if (view.state.doc.toString() !== query) {
                view.dispatch({
                    changes: {
                        from: 0,
                        to: view.state.doc.length,
                        insert: query,
                    },
                });
            }
        },
        refreshSchema() {
            // Applying new documents does not change editor text, so refresh
            // diagnostics explicitly and discard the old completion menu.
            closeCompletion(view);
            view.dispatch(setDiagnostics(view.state, lint(view)));
        },
        setTheme(dark) {
            view.dispatch({ effects: theme.reconfigure(editorTheme(dark)) });
        },
        format() {
            // The adapter dispatches an edit through CodeMirror's history.
            format(view);
        },
        focus: () => view.focus(),
        // Release the DOM, listeners and plugins on unmount/editor switch.
        dispose: () => view.destroy(),
    };
}
// #endregion codemirror-editor

function editorTheme(dark: boolean) {
    // Host styling, not part of the SQL adapter. Replace these CSS variables
    // with your application's theme when copying the integration.
    return EditorView.theme(
        {
            '&': {
                height: '100%',
                backgroundColor: 'var(--cp-surface)',
                color: 'var(--cp-text)',
            },
            '.cm-scroller': {
                overflow: 'auto',
                fontFamily: 'Consolas, "Courier New", Courier, monospace',
            },
            '.cm-content': { caretColor: 'var(--cp-text)' },
            '.cm-gutters': {
                backgroundColor: 'var(--cp-bg)',
                color: 'var(--cp-text-muted)',
                borderColor: 'var(--cp-border)',
            },
            '.cm-tooltip': {
                backgroundColor: 'var(--cp-surface)',
                color: 'var(--cp-text)',
                borderColor: 'var(--cp-border)',
            },
            '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
                backgroundColor: 'var(--cp-accent)',
                color: 'var(--cp-accent-fg)',
            },
            '.cm-cosmosdb-hover': {
                padding: '8px',
                maxWidth: '32rem',
                whiteSpace: 'pre-wrap',
            },
            '&.cm-focused': { outline: '2px solid var(--cp-accent)' },
            '.cm-diagnostic-error': { borderColor: 'var(--cp-danger)' },
            '.cm-diagnostic-warning': { borderColor: 'var(--cp-warning)' },
            '.cm-selectionBackground': {
                backgroundColor: 'var(--cp-highlight)',
            },
        },
        { dark },
    );
}
// #endregion example
