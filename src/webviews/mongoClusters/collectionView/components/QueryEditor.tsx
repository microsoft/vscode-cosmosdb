/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, type JSX } from 'react';
// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
// eslint-disable-next-line import/no-internal-modules
import basicFindQuerySchema from '../../../../utils/json/mongo/autocomplete/basicMongoFindFilterSchema.json';
// eslint-disable-next-line import/no-internal-modules
import { type editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { CollectionViewContext } from '../collectionViewContext';
import { MonacoAdaptive } from './MonacoAdaptive';

export const QueryEditor = ({ onExecuteRequest }): JSX.Element => {
    const [, setCurrentContext] = useContext(CollectionViewContext);

    const handleEditorDidMount = (editor: monacoEditor.editor.IStandaloneCodeEditor, monaco: typeof monacoEditor) => {
        editor.setValue('{  }');

        const getCurrentContentFunction = () => editor.getValue();
        // adding the function to the context for use outside of the editor
        setCurrentContext((prev) => ({
            ...prev,
            queryEditor: {
                getCurrentContent: getCurrentContentFunction,
                setJsonSchema: async (schema) => {
                    /**
                     * allows me to set the schema for the monaco editor
                     * at runtime.
                     *
                     * TODO: facing some errors when trying to set it using this callback
                     * during the initialization phase of the editor. Currently a workaorund
                     * is in place, but it'd be good to know how to avoid / catch
                     * these Network Errors in general.
                     *
                     * Even though it works just fine when done below in the on mount handler.
                     *
                     * Added a delay to get it operational for feature completeness.
                     * But we should find a way to confirm that the json worker is loaded/initialized
                     * and only then update the diagnostics options.
                     */

                    void (await new Promise((resolve) => {
                        // a delay of 2s to ensure the json worker is loaded
                        // TODO: find a way to confirm that it's loaded
                        setTimeout(resolve, 2000);
                    }));

                    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
                        validate: true,
                        schemas: [
                            {
                                uri: 'mongodb-filter-query-schema.json', // Unique identifier
                                fileMatch: ['*'], // Apply to all JSON files or specify as needed
                                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                                schema: schema,
                            },
                        ],
                    });
                },
            },
        }));

        // initialize the monaco editor with the schema that's basic
        // as we don't know the schema of the collection available
        // this is a fallback for the case when the autocompletion feature fails.
        monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
            validate: true,
            schemas: [
                {
                    uri: 'mongodb-filter-query-schema.json', // Unique identifier
                    fileMatch: ['*'], // Apply to all JSON files or specify as needed
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    schema: basicFindQuerySchema,
                    // schema: generateMongoFindJsonSchema(fieldEntries)
                },
            ],
        });
    };

    const monacoOptions: editor.IStandaloneEditorConstructionOptions = {
        contextmenu: false,
        fontSize: 14,
        lineHeight: 19,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        overviewRulerLanes: 0,
        glyphMargin: false,
        folding: false,
        renderLineHighlight: 'none',
        minimap: {
            enabled: false,
        },
        lineNumbers: 'off',
        scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
        },
        readOnly: false,
        scrollBeyondLastLine: false,
        automaticLayout: false,
    };

    return (
        <MonacoAdaptive
            height={'100%'}
            width={'100%'}
            language="json"
            adaptiveHeight={{
                enabled: true,
                maxLines: 10,
                minLines: 1,
                lineHeight: 19,
            }}
            onExecuteRequest={(input) => {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                onExecuteRequest(input);
            }}
            onMount={handleEditorDidMount}
            options={monacoOptions}
        />
    );
};
