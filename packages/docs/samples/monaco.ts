/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// #region example
// Load editor features (suggestions, hover, commands), not other languages.
import 'monaco-editor/esm/vs/editor/editor.all.js';
import {
    cosmosDbSqlLanguageConfiguration,
    cosmosDbSqlMonarchTokensProvider,
    MonacoDiagnosticsProvider,
    registerCosmosDbSql,
} from '@azure/cosmosdb-nosql-language-service/monaco';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
// Vite bundles this import as a worker constructor, not a CDN resource.
// oxlint-disable-next-line import/default
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { type EditorOptions, type PlaygroundEditor } from '../src/editor';

let nextEditorId = 0;
const availableLanguageIds: string[] = [];

// #region monaco-editor
/**
 * Import dynamically after the container mounts: Monaco requires the DOM.
 * options.service supplies SQL features; onChange preserves the host's text.
 */
export function createMonacoEditor(options: EditorOptions): PlaygroundEditor {
    // Configure Monaco's editor worker without replacing an existing host
    // configuration. Our SQL service still runs on the main thread.
    self.MonacoEnvironment ??= { getWorker: () => new EditorWorker() };

    // Providers are registered by language, not editor instance.
    // Separate IDs prevent one editor from using another editor's schema.
    // Reuse IDs because Monaco cannot unregister language metadata.
    const languageId =
        availableLanguageIds.pop() ?? `cosmosdb-playground-${nextEditorId++}`;
    if (
        !monaco.languages
            .getLanguages()
            .some((language) => language.id === languageId)
    ) {
        monaco.languages.register({ id: languageId });
    }
    // Configuration supplies brackets/comments; Monarch supplies token colors.
    // Keep these handles ourselves: the 1.0.0 helper does not retain them.
    const configuration = monaco.languages.setLanguageConfiguration(
        languageId,
        cosmosDbSqlLanguageConfiguration,
    );
    const tokenizer = monaco.languages.setMonarchTokensProvider(
        languageId,
        cosmosDbSqlMonarchTokensProvider,
    );
    // Register completion, hover, signatures, formatting and folding.
    // Diagnostics are managed below so schema changes can refresh markers;
    // multi-query separator decorations are optional and omitted here.
    const providers = registerCosmosDbSql(monaco, options.service, {
        languageId,
        monarchTokenizer: false,
        diagnostics: false,
        multiQueryDecorations: false,
    });
    // The model owns text and undo history; the editor renders it.
    // This sample creates both, so it must eventually dispose both.
    const model = monaco.editor.createModel(options.query, languageId);
    const editor = monaco.editor.create(options.container, {
        model,
        automaticLayout: true,
        minimap: { enabled: false },
        ariaLabel: 'Cosmos DB SQL query',
        accessibilitySupport: 'on',
        theme: options.dark ? 'vs-dark' : 'vs',
        scrollBeyondLastLine: false,
        tabSize: 2,
        wordWrap: 'on',
    });
    // Debounce parser diagnostics during typing. Notify the host on text
    // changes so switching editors does not lose the current query.
    let diagnostics = new MonacoDiagnosticsProvider(monaco, options.service, {
        languageId,
        diagnosticDelay: 150,
    });
    const changes = model.onDidChangeContent(() =>
        options.onChange(model.getValue()),
    );
    let disposed = false;

    return {
        setQuery(query) {
            if (model.getValue() !== query) model.setValue(query);
        },
        refreshSchema() {
            // Providers read getSchema on each request. Close stale suggestions
            // and recreate the marker controller without changing the model.
            editor.trigger('schema-refresh', 'hideSuggestWidget', {});
            diagnostics.dispose();
            diagnostics = new MonacoDiagnosticsProvider(
                monaco,
                options.service,
                { languageId, diagnosticDelay: 150 },
            );
        },
        setTheme(dark) {
            monaco.editor.setTheme(dark ? 'vs-dark' : 'vs');
        },
        format() {
            // Convert service ranges to Monaco edits rather than setValue:
            // undo should restore the original text, including formatting.
            const edits = options.service.getFormatEdits(model.getValue());
            editor.pushUndoStop();
            editor.executeEdits(
                'cosmosdb-format',
                edits.map((edit) => ({
                    range: new monaco.Range(
                        edit.range.startLine,
                        edit.range.startColumn,
                        edit.range.endLine,
                        edit.range.endColumn,
                    ),
                    text: edit.newText,
                })),
            );
            editor.pushUndoStop();
        },
        focus: () => editor.focus(),
        dispose() {
            // Call on unmount or before switching to another editor.
            // Remove listeners/providers as well as the visible editor.
            if (disposed) return;
            disposed = true;
            changes.dispose();
            diagnostics.dispose();
            providers.dispose();
            editor.dispose();
            model.dispose();
            tokenizer.dispose();
            configuration.dispose();
            availableLanguageIds.push(languageId);
        },
    };
}
// #endregion monaco-editor
// #endregion example
