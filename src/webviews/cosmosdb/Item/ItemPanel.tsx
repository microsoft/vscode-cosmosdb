/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, MessageBar, ProgressBar } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useEffect, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { validateCosmosDBItem } from '../../../cosmosdb/utils/validateCosmosDBItem';
import { MonacoEditor } from '../../MonacoEditor';
import { ItemToolbar } from './ItemToolbar';
import { useItemDispatcher, useItemState } from './state/ItemContext';
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

export const ItemPanel = () => {
    const classes = useClasses();
    const state = useItemState();
    const dispatcher = useItemDispatcher();

    const isReady = state.isReady;
    const isReadOnly = state.mode === 'view';
    const inProgress = state.isSaving || state.isRefreshing;
    const hasItemInDB = state.itemId !== '';

    const onSave = async () => {
        // Save item to the database
        await dispatcher.saveItem(state.currentItemContent);
    };

    const onEdit = async () => {
        // Open item for editing
        await dispatcher.setMode('edit');
    };

    const onRefresh = async () => {
        // Reload original item from the database
        if (state.isDirty) {
            setOpen(true);
            setDoAction(() => async () => {
                setOpen(false);
                await dispatcher.refreshItem();
            });
        } else {
            await dispatcher.refreshItem();
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
            enabled: () => !inProgress && hasItemInDB, // The same check is done in the toolbar
            enableOnFormTags: ['textarea'], // Allow refreshing when the focus is in the editor
        },
    );

    const onChange = (newValue: string) => {
        dispatcher.setCurrentItemContent(newValue);

        const errors = validateCosmosDBItem(newValue, state.partitionKey);

        dispatcher.setValid(errors.length === 0, errors);
    };

    // TODO: Hack, remove this when ItemPanel will be moved to CustomTextEditor.
    useEffect(() => {
        void dispatcher?.notifyDirty?.(state.isDirty);
    }, [dispatcher, state.isDirty]);

    if (!isReady || !state.currentItemContent) {
        return (
            <section className={classes.container}>
                <ProgressBar />
            </section>
        );
    }

    return (
        <section className={classes.container}>
            <UnsavedChangesDialog open={open} setOpen={setOpen} doAction={doAction} />
            <ItemToolbar onSave={onSave} onEdit={onEdit} onRefresh={onRefresh} />
            {inProgress && <ProgressBar />}
            {state.error && (
                <MessageBar key={'error'} intent={'error'} layout={'multiline'}>
                    {state.error}
                </MessageBar>
            )}
            {isReadOnly && <MessageBar intent={'info'}>{l10n.t('This item is read-only.')}</MessageBar>}
            <section className={classes.resultDisplay}>
                <MonacoEditor
                    height={'100%'}
                    width={'100%'}
                    defaultLanguage={'json'}
                    value={state.currentItemContent ?? l10n.t('No result')}
                    options={{ domReadOnly: isReadOnly, readOnly: isReadOnly, scrollBeyondLastLine: false }}
                    onChange={onChange}
                />
            </section>
        </section>
    );
};
