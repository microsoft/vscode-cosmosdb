/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Dropdown, Option, ProgressBar, makeStyles, type OptionOnSelectData } from '@fluentui/react-components';
import { Dismiss12Regular, RecordStopFilled, SendFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { WebviewContext } from '../../../WebviewContext';
import { useQueryEditorState, useQueryEditorStateDispatch } from '../state/QueryEditorContext';
import { usePromptHistory } from './usePromptHistory';

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
        position: 'relative',
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
    modelDropdown: {
        minWidth: 'auto',
        backgroundColor: 'transparent',
        border: 'none',
        '& button': {
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: 'none',
            padding: '0px 4px',
            minHeight: 'auto',
            fontSize: '11px',
            color: 'var(--vscode-descriptionForeground)',
            '&:hover': {
                backgroundColor: 'transparent',
                color: 'var(--vscode-foreground)',
            },
            '&:focus': {
                borderBottom: 'none',
                outline: 'none',
            },
            '&:focus-visible': {
                borderBottom: 'none',
                outline: 'none',
            },
            '&::after': {
                display: 'none',
                content: 'none',
                borderBottom: 'none',
            },
            '&:focus-within::after': {
                display: 'none',
                content: 'none',
                borderBottom: 'none',
            },
        },
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
        marginRight: '-10px',
    },
    progressBar: {
        width: '100%',
        marginTop: '0px',
    },
    closeButton: {
        position: 'absolute',
        top: '2px',
        right: '2px',
        padding: '0px',
        minWidth: '16px',
        width: '16px',
        height: '16px',
        fontSize: '10px',
        color: 'var(--vscode-descriptionForeground)',
        backgroundColor: 'transparent',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
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

    // Prompt history for arrow up/down navigation
    const promptHistory = usePromptHistory({ maxSize: 50 });

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

    // Listen for queryGenerated event to stop loading and clear input on success
    useEffect(() => {
        // Parameters: generatedQuery (string on success, false on failure), modelName, submittedPrompt
        const handler = (generatedQuery: string | false, _modelName?: string, submittedPrompt?: string) => {
            setIsLoading(false);
            // Only clear input and save to history on successful generation
            if (generatedQuery !== false) {
                // Add the submitted prompt to history
                if (submittedPrompt) {
                    promptHistory.addToHistory(submittedPrompt);
                }
                setInput('');
                setLineCount(1);
            }
        };
        void channel.on('queryGenerated', handler as never);
    }, [channel, promptHistory]);

    // Listen for availableModels event
    useEffect(() => {
        const handler = (models: ModelInfo[], savedModelId: string | null) => {
            // Sort models so "Auto" appears at the top if present
            const sortedModels = [...models].sort((a, b) => {
                const aIsAuto = a.name.toLowerCase() === 'auto';
                const bIsAuto = b.name.toLowerCase() === 'auto';
                if (aIsAuto && !bIsAuto) return -1;
                if (!aIsAuto && bIsAuto) return 1;
                return 0;
            });
            setAvailableModels(sortedModels);
            if (savedModelId && sortedModels.some((m) => m.id === savedModelId)) {
                setSelectedModelId(savedModelId);
            } else if (sortedModels.length > 0) {
                setSelectedModelId(sortedModels[0].id);
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

            // Input will be cleared by queryGenerated handler on success
        } catch (error) {
            console.error('Failed to generate query:', error);
            setIsLoading(false);
        }
    };

    const handleCancel = () => {
        // Send cancel command to extension
        void channel.postMessage({
            type: 'event',
            name: 'command',
            params: [
                {
                    commandName: 'cancelGenerateQuery',
                    params: [],
                },
            ],
        });
        setIsLoading(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            if (isLoading) {
                handleCancel();
            } else {
                dispatch({ type: 'toggleGenerateInput' });
            }
        } else if (e.key === 'ArrowUp') {
            // Navigate to previous prompt in history
            const previousPrompt = promptHistory.navigatePrevious(input);
            if (previousPrompt !== null) {
                e.preventDefault();
                setInput(previousPrompt);
                const lines = calculateLineCount(previousPrompt, textareaRef.current);
                setLineCount(lines);
            }
        } else if (e.key === 'ArrowDown') {
            // Navigate to next prompt in history
            const nextPrompt = promptHistory.navigateNext();
            if (nextPrompt !== null) {
                e.preventDefault();
                setInput(nextPrompt);
                const lines = calculateLineCount(nextPrompt, textareaRef.current);
                setLineCount(lines);
            }
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.chatBox}>
                <Button
                    className={styles.closeButton}
                    icon={<Dismiss12Regular />}
                    onClick={() => dispatch({ type: 'toggleGenerateInput' })}
                    title={l10n.t('Close')}
                    aria-label={l10n.t('Close')}
                    appearance="transparent"
                    size="small"
                />
                <textarea
                    ref={textareaRef}
                    className={styles.textarea}
                    placeholder={l10n.t('Describe your query in natural language')}
                    value={input}
                    onChange={(e) => {
                        const newValue = e.currentTarget.value;
                        setInput(newValue);
                        const lines = calculateLineCount(newValue, textareaRef.current);
                        setLineCount(lines);
                        // Reset history navigation when user types
                        promptHistory.resetNavigation();
                    }}
                    onKeyDown={handleKeyDown}
                    disabled={isLoading}
                    rows={1}
                    style={{ height: `${Math.max(1, lineCount) * 17}px` }}
                />
                {isLoading ? <ProgressBar className={styles.progressBar} /> : <div style={{ height: '2px' }} />}
                <div className={styles.footer}>
                    {availableModels.length > 1 ? (
                        <Dropdown
                            className={styles.modelDropdown}
                            onOptionSelect={(_event, data) => handleModelChange(data)}
                            size="small"
                            appearance="filled-lighter"
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
                        icon={isLoading ? <RecordStopFilled /> : <SendFilled />}
                        onClick={isLoading ? handleCancel : () => void handleSend()}
                        disabled={!isLoading && !input.trim()}
                        title={isLoading ? l10n.t('Cancel generation') : l10n.t('Generate query')}
                        aria-label={isLoading ? l10n.t('Cancel generation') : l10n.t('Generate query')}
                        appearance="transparent"
                    />
                </div>
            </div>
        </div>
    );
};
