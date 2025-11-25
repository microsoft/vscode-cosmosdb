/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Input, makeStyles } from '@fluentui/react-components';
import { SendFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useContext, useState } from 'react';
import { WebviewContext } from '../../../WebviewContext';
import { useQueryEditorState, useQueryEditorStateDispatch } from '../state/QueryEditorContext';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px',
        backgroundColor: 'transparent',
        borderTop: '1px solid var(--vscode-sideBarSectionHeader-border)',
        borderBottom: '1px solid var(--vscode-sideBarSectionHeader-border)',
    },
    input: {
        flex: 1,
        backgroundColor: 'var(--vscode-input-background)',
    },
    button: {
        padding: '6px 12px',
        minWidth: 'auto',
    },
});

export const GenerateQueryInput = () => {
    const styles = useStyles();
    const { channel } = useContext(WebviewContext);
    const state = useQueryEditorState();
    const dispatch = useQueryEditorStateDispatch();
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);

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
            // Hide input bar
            dispatch({ type: 'toggleGenerateInput' });
        } catch (error) {
            console.error('Failed to generate query:', error);
        } finally {
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
            <Input
                className={styles.input}
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
    );
};
