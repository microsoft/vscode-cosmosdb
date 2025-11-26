/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    List,
    ListItem,
    makeStyles,
    MessageBar,
    type MessageBarProps,
    ProgressBar,
    Text,
} from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { validateDocument } from '../../../cosmosdb/utils/validateDocument';
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
    messageGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
    },
});

interface MessageBarWrapperProps extends MessageBarProps {
    visible: boolean;
    debounceTime?: number; // Time to wait before announcing after changes
    children?: ReactNode;
}

const MessageBarWrapper = ({ visible, children, debounceTime = 0, ...props }: MessageBarWrapperProps) => {
    const [isVisible, setIsVisible] = useState(visible);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        // Clear any existing timer
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }

        // If visibility is turning off, apply immediately (next tick)
        // If debounceTime is 0, also apply on next tick
        // Otherwise, delay by debounceTime
        const delay = !visible || debounceTime === 0 ? 0 : debounceTime;

        debounceTimerRef.current = setTimeout(() => {
            setIsVisible(visible);
        }, delay);

        // Cleanup timer on unmount or when dependencies change
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
        };
    }, [visible, debounceTime]);

    // Only render children when visible
    return isVisible ? <MessageBar {...props}>{children}</MessageBar> : null;
};

/**
 * Fake progress bar component to show a mock bar to prevent layout shift
 */
const FakeProgressBar = () => <div style={{ height: '2px' }} />;

export const DocumentPanel = () => {
    const classes = useClasses();
    const state = useDocumentState();
    const dispatcher = useDocumentDispatcher();

    const errors = state.error ? (Array.isArray(state.error) ? state.error : [state.error]) : [];
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

    // TODO: At this moment the dirty (and others) state is used only on UI.
    //  But the server side also has to be aware of the dirty state to prevent data loss.
    //  If the documents will moved to the custom editor, the editor will know about the dirty state itself.
    useEffect(() => {
        void dispatcher?.notifyDirty?.(state.isDirty);
    }, [dispatcher, state.isDirty]);

    if (!state.isReady || !state.currentDocumentContent) {
        return (
            <section className={classes.container} tabIndex={-1}>
                <ProgressBar />
            </section>
        );
    }

    return (
        <section className={classes.container} tabIndex={-1}>
            <DocumentToolbar />
            {inProgress && <ProgressBar />}
            {!inProgress && <FakeProgressBar />}
            <section role={'status'} aria-atomic={'false'} className={classes.messageGroup}>
                <MessageBarWrapper key={'readonly'} visible={isReadOnly} debounceTime={0} intent={'info'}>
                    <Text>{l10n.t('This item is read-only. To edit it, switch to edit mode.')}</Text>
                </MessageBarWrapper>
                <MessageBarWrapper key={'edit'} visible={!isReadOnly} debounceTime={0} intent={'info'}>
                    <Text>{l10n.t('This item is editable.')}</Text>
                </MessageBarWrapper>
                <MessageBarWrapper
                    /* Since it is just a Webview, we can't show the dirty state in the tab title */
                    key={'dirty'}
                    visible={state.isDirty}
                    debounceTime={500}
                    intent={'warning'}
                >
                    <Text>{l10n.t('This item has unsaved changes.')}</Text>
                </MessageBarWrapper>
                <MessageBarWrapper
                    key={'error'}
                    visible={!!errors.length}
                    debounceTime={2000}
                    intent={errors.length ? 'error' : 'success'}
                >
                    {errors.length > 0 && (
                        <List>
                            <ListItem>
                                {l10n.t(
                                    'This item contains {count} validation error{isPlural}. Please fix them before saving.',
                                    {
                                        count: errors.length,
                                        isPlural: errors.length > 1 ? 's' : '',
                                    },
                                )}
                            </ListItem>
                            {errors.map((error, index) => (
                                <ListItem aria-setsize={errors.length} aria-posinset={index + 1} key={index}>
                                    <Text>{error}</Text>
                                </ListItem>
                            ))}
                        </List>
                    )}
                    {errors.length === 0 && <Text>{l10n.t('This item is valid and ready to be saved.')}</Text>}
                </MessageBarWrapper>
            </section>
            <section className={classes.resultDisplay}>
                <MonacoEditor
                    height={'100%'}
                    width={'100%'}
                    defaultLanguage={'json'}
                    value={state.currentDocumentContent ?? l10n.t('No result')}
                    options={{ domReadOnly: isReadOnly, readOnly: isReadOnly, scrollBeyondLastLine: false }}
                    onChange={onChange}
                />
            </section>
        </section>
    );
};
