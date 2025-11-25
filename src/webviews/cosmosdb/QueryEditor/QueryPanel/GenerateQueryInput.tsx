/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Input, ProgressBar, makeStyles } from '@fluentui/react-components';
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
    },
    inputRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '6px 8px',
    },
    input: {
        flex: 1,
        backgroundColor: 'var(--vscode-editor-background)',
        fontSize: '12px',
    },
    inputLoading: {
        borderBottom: '2px solid var(--vscode-progressBar-background)',
    },
    button: {
        padding: '4px 8px',
        minWidth: 'auto',
        fontSize: '12px',
    },
    progressBar: {
        width: '100%',
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

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
            <div className={styles.inputRow}>
                <Input
                    className={`${styles.input} ${isLoading ? styles.inputLoading : ''}`}
                    placeholder={l10n.t('Ask Copilot to generate the query for you')}
                    value={input}
                    onChange={(_, data) => setInput(data.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isLoading}
                />
                <Button
                    className={styles.button}
                    icon={<SendFilled />}
                    onClick={() => void handleSend()}
                    disabled={!input.trim() || isLoading}
                    title={l10n.t('Generate query')}
                    aria-label={l10n.t('Generate query')}
                />
            </div>
            {isLoading && <ProgressBar className={styles.progressBar} />}
        </div>
    );
};
