/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { debounce } from 'es-toolkit';
import * as React from 'react';
import { MonacoEditor } from '../../../MonacoEditor';

// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';

interface Props {
    value: string[];
}

const monacoOptions = {
    minimap: {
        enabled: true,
    },
    scrollBeyondLastLine: false,
    readOnly: true,
    automaticLayout: false,
};

export const DataViewPanelJSON = ({ value }: Props): React.JSX.Element => {
    const editorRef = React.useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);

    const handleResize = React.useCallback(() => {
        editorRef.current?.layout();
    }, []);

    React.useEffect(() => {
        // Add the debounced resize event listener
        const debouncedResizeHandler = debounce(handleResize, 200);
        window.addEventListener('resize', debouncedResizeHandler);

        // Initial layout adjustment
        handleResize();

        // Clean up on component unmount
        return () => {
            editorRef.current?.dispose();
            window.removeEventListener('resize', debouncedResizeHandler);
        };
    }, [handleResize]);

    return (
        <MonacoEditor
            height={'100%'}
            width={'100%'}
            language="json"
            options={monacoOptions}
            onMount={(editor) => {
                // Store the editor instance in ref
                editorRef.current = editor;
                handleResize();
            }}
            value={value.join('\n\n')}
        />
    );
};
