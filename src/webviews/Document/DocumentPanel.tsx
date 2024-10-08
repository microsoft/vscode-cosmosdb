/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MonacoEditor } from '../MonacoEditor';
import { DocumentToolbar } from './DocumentToolbar';
import { useDocumentState } from './state/DocumentContext';

export const DocumentPanel = () => {
    const state = useDocumentState();
    const isReadOnly = state.mode === 'view';

    return (
        <div>
            <DocumentToolbar />
            <MonacoEditor
                height={'100%'}
                width={'100%'}
                defaultLanguage={'json'}
                value={'No result'}
                options={{ domReadOnly: isReadOnly, readOnly: isReadOnly }}
            />
        </div>
    );
};
