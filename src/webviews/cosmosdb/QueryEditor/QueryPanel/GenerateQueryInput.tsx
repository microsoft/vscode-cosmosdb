/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Dropdown, Option, ProgressBar, makeStyles, type OptionOnSelectData } from '@fluentui/react-components';
import { SendFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { WebviewContext } from '../../../WebviewContext';
import { useQueryEditorState, useQueryEditorStateDispatch } from '../state/QueryEditorContext';

interface ModelInfo {
    id: string;
    name: string;
    family: string;
    vendor: string;
}

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
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [lineCount, setLineCount] = useState(1);
    const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
    const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

    // Get display name for currently selected model
    const selectedModel = availableModels.find((m) => m.id === selectedModelId) ?? availableModels[0];
    const modelDisplayName = selectedModel?.name ?? 'Copilot';

    // Calculate line count based on text content and textarea width
    const calculateLineCount = (text: string, textarea: HTMLTextAreaElement | null) => {
        if (!textarea || !text) {
            return 1;
        }

        // Count explicit line breaks
        const explicitLines = text.split('\n');

        // For each line, estimate wrapped lines based on character count and textarea width
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) return explicitLines.length;

        const computedStyle = window.getComputedStyle(textarea);
        context.font = `${computedStyle.fontSize} ${computedStyle.fontFamily}`;

        const textareaWidth = textarea.clientWidth - 4; // Account for padding
        let totalLines = 0;

        for (const line of explicitLines) {
            if (line.length === 0) {
                totalLines += 1;
            } else {
                const textWidth = context.measureText(line).width;
                const wrappedLines = Math.max(1, Math.ceil(textWidth / textareaWidth));
                totalLines += wrappedLines;
            }
        }

        return Math.max(1, totalLines);
    };

    // Listen for queryGenerated event to stop loading
    useEffect(() => {
        const handler = () => {
            setIsLoading(false);
        };
        void channel.on('queryGenerated', handler as never);
    }, [channel]);

    // Listen for availableModels event
    useEffect(() => {
        const handler = (models: ModelInfo[], savedModelId: string | null) => {
            setAvailableModels(models);
            if (savedModelId && models.some((m) => m.id === savedModelId)) {
                setSelectedModelId(savedModelId);
            } else if (models.length > 0) {
                setSelectedModelId(models[0].id);
            }
        };
        void channel.on('availableModels', handler as never);
    }, [channel]);

    // Fetch available models when input becomes visible
    useEffect(() => {
        if (state.showGenerateInput) {
            void channel.postMessage({
                type: 'event',
                name: 'command',
                params: [
                    {
                        commandName: 'getAvailableModels',
                        params: [],
                    },
                ],
            });
        }
    }, [state.showGenerateInput, channel]);

    // Handle model selection change
    const handleModelChange = useCallback(
        (data: OptionOnSelectData) => {
            const modelId = data.optionValue as string;
            setSelectedModelId(modelId);
            // Persist the selection
            void channel.postMessage({
                type: 'event',
                name: 'command',
                params: [
                    {
                        commandName: 'setSelectedModel',
                        params: [modelId],
                    },
                ],
            });
        },
        [channel],
    );

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
                    ref={textareaRef}
                    className={styles.textarea}
                    placeholder={l10n.t('Ask Copilot to generate the query for you')}
                    value={input}
                    onChange={(e) => {
                        const newValue = e.currentTarget.value;
                        setInput(newValue);
                        const lines = calculateLineCount(newValue, textareaRef.current);
                        setLineCount(lines);
                    }}
                    onKeyDown={handleKeyDown}
                    disabled={isLoading}
                    rows={1}
                    style={{ height: `${Math.max(1, lineCount) * 17}px` }}
                />
                {isLoading && <ProgressBar className={styles.progressBar} />}
                <div className={styles.footer}>
                    {availableModels.length > 1 ? (
                        <Dropdown
                            onOptionSelect={(_event, data) => handleModelChange(data)}
                            style={{ minWidth: '100px', maxWidth: '160px', fontSize: '11px' }}
                            size="small"
                            value={modelDisplayName}
                            selectedOptions={selectedModelId ? [selectedModelId] : []}
                            disabled={isLoading}
                        >
                            {availableModels.map((model) => (
                                <Option
                                    key={model.id}
                                    value={model.id}
                                    style={{ fontSize: '11px', padding: '4px 8px', minHeight: '20px' }}
                                >
                                    {model.name}
                                </Option>
                            ))}
                        </Dropdown>
                    ) : (
                        <div className={styles.modelLabel}>{modelDisplayName}</div>
                    )}
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
