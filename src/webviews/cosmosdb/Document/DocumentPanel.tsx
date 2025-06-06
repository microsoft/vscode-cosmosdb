/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, MessageBar, ProgressBar } from '@fluentui/react-components';
import { useCallback, useEffect } from 'react';
import { validateDocument } from '../../../cosmosdb/utils/validateDocument';
import { HotkeyScope, useHotkeyScope } from '../../common/hotkeys';
import { MonacoEditor } from '../../MonacoEditor';
import { DocumentToolbar } from './DocumentToolbar';
import { useDocumentDispatcher, useDocumentState } from './state/DocumentContext';

const useClasses = makeStyles({
    resultDisplay: {
        flexShrink: 1,
        flexGrow: 1,
        position: 'relative',
    },
    container: {
        marginTop: '10px',
        height: 'calc(100% - 10px)', // 10px margin
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'stretch',
        alignItems: 'stretch',
        gap: '5px',
    },
});

export const DocumentPanel = () => {
    const classes = useClasses();
    const state = useDocumentState();
    const dispatcher = useDocumentDispatcher();

    const isReadOnly = state.mode === 'view';
    const inProgress = state.isSaving || state.isRefreshing;

    const onChange = useCallback(
        (newValue: string) => {
            dispatcher.setCurrentDocumentContent(newValue);

            const errors = validateDocument(newValue, state.partitionKey);

            dispatcher.setValid(errors.length === 0, errors);
        },
        [dispatcher, state.partitionKey],
    );

    // Set up the scope for this component
    const editorRef = useHotkeyScope(HotkeyScope.DocumentEditor);

    // TODO: Hack, remove this when DocumentPanel will be moved to CustomTextEditor.
    useEffect(() => {
        void dispatcher?.notifyDirty?.(state.isDirty);
    }, [dispatcher, state.isDirty]);

    if (!state.isReady || !state.currentDocumentContent) {
        return (
            <section className={classes.container}>
                <ProgressBar />
            </section>
        );
    }

    return (
        <section className={classes.container} ref={editorRef} tabIndex={-1}>
            <DocumentToolbar />
            {inProgress && <ProgressBar />}
            {state.error && (
                <MessageBar key={'error'} intent={'error'} layout={'multiline'}>
                    {state.error}
                </MessageBar>
            )}
            {isReadOnly && <MessageBar intent={'info'}>This item is read-only.</MessageBar>}
            <section className={classes.resultDisplay}>
                <MonacoEditor
                    height={'100%'}
                    width={'100%'}
                    defaultLanguage={'json'}
                    value={state.currentDocumentContent ?? 'No result'}
                    options={{ domReadOnly: isReadOnly, readOnly: isReadOnly, scrollBeyondLastLine: false }}
                    onChange={onChange}
                />
            </section>
        </section>
    );
};
