/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getTheme } from '@fluentui/react';
import { useContext, useState, type JSX } from 'react';
import { MonacoEditor } from '../../../MonacoEditor';
// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';

// eslint-disable-next-line import/no-internal-modules
import basicFindQuerySchema from '../../../../utils/json/mongo/autocomplete/basicMongoFindFilterSchema.json';

// eslint-disable-next-line import/no-internal-modules
import { type editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { CollectionViewContext } from '../collectionViewContext';
// eslint-disable-next-line import/no-internal-modules

// eslint-disable-next-line import/no-internal-modules

// eslint-disable-next-line import/no-internal-modules

const theme = getTheme();

export const QueryEditor = ({ onExecuteRequest }): JSX.Element => {
    const [, setCurrentContext] = useContext(CollectionViewContext);

    const handleEditorDidMount = (editor: monacoEditor.editor.IStandaloneCodeEditor, monaco: typeof monacoEditor) => {
        const getCurrentContentFunction = () => editor.getValue();
        // adding the function to the context for use outside of the editor
        setCurrentContext((prev) => ({
            ...prev,
            queryEditor: {
                getCurrentContent: getCurrentContentFunction,
                setJsonSchema: (schema) => {
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

        // const fieldEntries : FieldEntry[]= [
        //     { path: 'age', type: 'number' },
        //     { path: 'name', type: 'string' },
        //     { path: 'boo', type: 'boolean' },
        //     { path: 'address.city', type: 'string' },
        //     { path: 'address.country', type: 'string' },
        // ];

        // initialize the monaco editor with the schema that's basic
        // as we don't know the schema of the collection available
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
        minimap: {
            enabled: false,
        },
        lineNumbers: 'off',
        scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
        },
        renderLineHighlight: 'none',
        readOnly: false,
        scrollBeyondLastLine: false,
    };

    const [editorHeight, setEditorHeight] = useState<number>(1 * 19); // Initial height

    return (
        <div
            className="monacoEditorContainer"
            style={
                {
                    height: editorHeight,
                    '--textbox-border-color': theme.palette.neutralLight, // Pass Fluent UI color as CSS variable
                } as React.CSSProperties
            }
        >
            <MonacoEditor
                height={'100%'}
                width={'100%'}
                language="json"
                adaptiveHeight={{
                    enabled: true,
                    maxLines: 10,
                    minLines: 1,
                    lineHeight: 19,
                    onEditorContentHeightChange: (height) => {
                        setEditorHeight(height); // Dynamically update the outer component's height
                    },
                }}
                onExecuteRequest={(input) => {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                    onExecuteRequest(input);
                }}
                onEditorMount={handleEditorDidMount}
                options={monacoOptions}
            />
        </div>
    );
};
