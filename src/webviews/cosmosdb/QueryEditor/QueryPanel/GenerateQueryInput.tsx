/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, ProgressBar, makeStyles } from '@fluentui/react-components';
import { SendFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useContext, useEffect, useState } from 'react';
import { WebviewContext } from '../../../WebviewContext';
import { useQueryEditorState, useQueryEditorStateDispatch } from '../state/QueryEditorContext';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'transparent',
        borderTop: '1px solid var(--vscode-sideBarSectionHeader-border)',
        borderBottom: '1px solid var(--vscode-sideBarSectionHeader-border)',
        padding: '8px 0px',
        gap: '0px',
        flexShrink: 0,
    },
    chatBox: {
        backgroundColor: 'rgba(135, 206, 235, 0.1)',
        borderRadius: '6px',
        padding: '8px 12px',
        border: '1px solid rgba(135, 206, 235, 0.3)',
        margin: '8px 12px',
        width: 'calc(100% - 24px)',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        minHeight: '0',
    },
    inputArea: {
        display: 'flex',
        alignItems: 'flex-end',
        gap: '6px',
    },
    textarea: {
        backgroundColor: 'transparent',
        border: 'none',
        outline: 'none',
        fontSize: '14px',
        fontFamily: 'inherit',
        color: 'var(--vscode-editor-foreground)',
        resize: 'none',
        lineHeight: '1.2',
        minHeight: '20px',
        padding: '0px',
        overflow: 'hidden',
        width: '100%',
    },
    footer: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '6px',
    },
    modelLabel: {
        fontSize: '11px',
        color: 'var(--vscode-descriptionForeground)',
        whiteSpace: 'nowrap',
    },
    button: {
        padding: '2px 6px',
        minWidth: 'auto',
        fontSize: '11px',
        color: 'var(--vscode-button-foreground)',
        backgroundColor: 'transparent',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    progressBar: {
        width: '100%',
        marginTop: '0px',
    },
});

export const GenerateQueryInput = () => {
    const styles = useStyles();
    const { channel } = useContext(WebviewContext);
    const state = useQueryEditorState();
    const dispatch = useQueryEditorStateDispatch();
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // Listen for queryGenerated event to stop loading
    useEffect(() => {
        const handler = () => {
            setIsLoading(false);
        };
        void channel.on('queryGenerated', handler as never);
    }, [channel]);

    if (!state.showGenerateInput) {
        return null;
    }

    const handleSend = async () => {
        if (!input.trim()) {
            return;
        }

        setIsLoading(true);
        try {
            // Get the current query content from the state
            const currentQuery = state.queryValue;

            // Send command to extension
            await channel.postMessage({
                type: 'event',
                name: 'command',
                params: [
                    {
                        commandName: 'generateQuery',
                        params: [input, currentQuery],
                    },
                ],
            });

            // Clear input
            setInput('');
        } catch (error) {
            console.error('Failed to generate query:', error);
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            dispatch({ type: 'toggleGenerateInput' });
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.chatBox}>
                <textarea
                    className={styles.textarea}
                    placeholder={l10n.t('Ask Copilot to generate the query for you')}
                    value={input}
                    onChange={(e) => {
                        setInput(e.currentTarget.value);
                        e.currentTarget.style.height = 'auto';
                        e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px';
                    }}
                    onKeyDown={handleKeyDown}
                    disabled={isLoading}
                    rows={1}
                />
                {isLoading && <ProgressBar className={styles.progressBar} />}
                <div className={styles.footer}>
                    <div className={styles.modelLabel}>Copilot</div>
                    <Button
                        className={styles.button}
                        icon={<SendFilled />}
                        onClick={() => void handleSend()}
                        disabled={!input.trim() || isLoading}
                        title={l10n.t('Generate query')}
                        aria-label={l10n.t('Generate query')}
                        appearance="transparent"
                    />
                </div>
            </div>
        </div>
    );
};
