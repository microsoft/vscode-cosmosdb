/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, MessageBar, ProgressBar } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { validateDocument } from '../../../cosmosdb/utils/validateDocument';
import { MonacoEditor } from '../../MonacoEditor';
import { DocumentToolbar } from './DocumentToolbar';
import { useDocumentDispatcher, useDocumentState } from './state/DocumentContext';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';

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

    const isReady = state.isReady;
    const isReadOnly = state.mode === 'view';
    const inProgress = state.isSaving || state.isRefreshing;
    const hasDocumentInDB = state.documentId !== '';

    const onSave = async () => {
        // Save document to the database
        await dispatcher.saveDocument(state.currentDocumentContent);
    };

    const onEdit = async () => {
        // Open document for editing
        await dispatcher.setMode('edit');
    };

    const onRefresh = async () => {
        // Reload original document from the database
        if (state.isDirty) {
            setOpen(true);
            setDoAction(() => async () => {
                setOpen(false);
                await dispatcher.refreshDocument();
            });
        } else {
            await dispatcher.refreshDocument();
        }
    };

    const [open, setOpen] = useState(false);
    const [doAction, setDoAction] = useState<() => Promise<void>>(() => async () => {});

    const stopPropagation = (event: KeyboardEvent) => {
        event.stopPropagation();
        event.preventDefault();
    };
    useHotkeys(
        'mod+s, mod+shift+s',
        (event) => {
            stopPropagation(event);
            void onSave();
        },
        {
            enabled: () => !inProgress && state.isDirty && state.isValid, // The same check is done in the toolbar
            enableOnFormTags: ['textarea'], // Allow saving when the focus is in the editor
        },
    );

    useHotkeys(
        'mod+shift+e',
        (event) => {
            stopPropagation(event);
            void onEdit();
        },
        {
            enabled: () => isReadOnly, // The same check is done in the toolbar
            enableOnFormTags: ['textarea'], // Allow editing when the focus is in the editor
        },
    );

    useHotkeys(
        'mod+shift+r',
        (event) => {
            stopPropagation(event);
            void onRefresh();
        },
        {
            enabled: () => !inProgress && hasDocumentInDB, // The same check is done in the toolbar
            enableOnFormTags: ['textarea'], // Allow refreshing when the focus is in the editor
        },
    );

    const onChange = (newValue: string) => {
        dispatcher.setCurrentDocumentContent(newValue);

        const errors = validateDocument(newValue, state.partitionKey);

        dispatcher.setValid(errors.length === 0, errors);
    };

    // TODO: Hack, remove this when DocumentPanel will be moved to CustomTextEditor.
    useEffect(() => {
        void dispatcher?.notifyDirty?.(state.isDirty);
    }, [dispatcher, state.isDirty]);

    if (!isReady || !state.currentDocumentContent) {
        return (
            <section className={classes.container}>
                <ProgressBar />
            </section>
        );
    }

    return (
        <section className={classes.container}>
            <UnsavedChangesDialog open={open} setOpen={setOpen} doAction={doAction} />
            <DocumentToolbar onSave={onSave} onEdit={onEdit} onRefresh={onRefresh} />
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
