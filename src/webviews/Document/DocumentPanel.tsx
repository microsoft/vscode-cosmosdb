/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, MessageBar, MessageBarBody, MessageBarTitle, ProgressBar } from '@fluentui/react-components';
import { MonacoEditor } from '../MonacoEditor';
import { DocumentToolbar } from './DocumentToolbar';
import { useDocumentState } from './state/DocumentContext';

const useClasses = makeStyles({
    resultDisplay: {
        marginTop: '10px',
        width: '100%',
        height: 'calc(100% - 50px)',
    },
    container: {
        height: '100%',
    },
});

export const DocumentPanel = () => {
    const classes = useClasses();
    const state = useDocumentState();
    const isReadOnly = state.mode === 'view';

    return (
        <div className={classes.container}>
            {state.error && (
                <MessageBar key={'error'} intent={'error'}>
                    <MessageBarBody>
                        <MessageBarTitle>Internal error</MessageBarTitle>
                        {state.error}
                    </MessageBarBody>
                </MessageBar>
            )}
            <DocumentToolbar />
            {state.isRefreshing && <ProgressBar />}
            <section className={classes.resultDisplay}>
                <MonacoEditor
                    height={'100%'}
                    width={'100%'}
                    defaultLanguage={'json'}
                    value={state.documentContent ?? 'No result'}
                    options={{ domReadOnly: isReadOnly, readOnly: isReadOnly }}
                />
            </section>
        </div>
    );
};
