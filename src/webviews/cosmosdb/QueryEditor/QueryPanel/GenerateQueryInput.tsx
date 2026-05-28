/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Combobox,
    Option,
    createCustomFocusIndicatorStyle,
    makeStyles,
    mergeClasses,
    type OptionOnSelectData,
} from '@fluentui/react-components';
import {
    CheckmarkFilled,
    Dismiss12Regular,
    DismissFilled,
    RecordStopFilled,
    SendFilled,
    ThumbDislikeFilled,
    ThumbDislikeRegular,
    ThumbLikeFilled,
    ThumbLikeRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type QueryEditorAppRouter } from '../../../../panels/trpc/appRouter';
import { useTrpcClient } from '../../../api/trpc/useTrpcClient';
import { useQueryEditorState, useQueryEditorStateDispatch } from '../state/QueryEditorContext';
import { usePromptHistory } from './usePromptHistory';

interface ModelInfo {
    id: string;
    name: string;
    family?: string;
    vendor?: string;
}

const useStyles = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--vscode-input-background)',
        borderRadius: '6px',
        border: '1px solid var(--vscode-input-border, var(--vscode-contrastBorder, transparent))',
        margin: '8px 8px',
        boxSizing: 'border-box',
        minHeight: '0',
        flexShrink: 0,
        position: 'relative',
    },
    containerFocused: {
        borderTopColor: 'var(--vscode-focusBorder)',
        borderRightColor: 'var(--vscode-focusBorder)',
        borderBottomColor: 'var(--vscode-focusBorder)',
        borderLeftColor: 'var(--vscode-focusBorder)',
    },
    innerContent: {
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '8px 8px 6px',
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
    modelSection: {
        display: 'flex',
        alignItems: 'center',
        gap: '0px',
    },
    feedbackButtons: {
        display: 'flex',
        alignItems: 'center',
        gap: '0px',
        marginLeft: '16px',
    },
    feedbackButton: {
        padding: '2px',
        fontSize: '16px',
        minWidth: 'auto',
        minHeight: 'auto',
        color: 'var(--vscode-descriptionForeground)',
        backgroundColor: 'transparent',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        '&:hover': {
            color: 'var(--vscode-foreground)',
        },
        ':focus-visible': {
            outlineStyle: 'none',
        },
        ...(createCustomFocusIndicatorStyle(
            {
                outline: '1px solid var(--vscode-focusBorder)',
                outlineOffset: '0px',
                boxShadow: 'none',
                borderColor: 'transparent',
                borderRadius: '3px',
            },
            { customizeSelector: (s) => `${s}${s}` },
        ) as Record<string, unknown>),
    },
    modelDropdown: {
        minWidth: 'auto',
        backgroundColor: 'transparent',
        border: 'none',
        overflow: 'visible',
        '&:focus-within': {
            outline: '1px solid var(--vscode-focusBorder)',
            outlineOffset: '0px',
            borderRadius: '3px',
        },
        '& input': {
            backgroundColor: 'transparent',
            border: 'none',
            padding: '0px 4px',
            minHeight: 'auto',
            fontSize: '11px',
            color: 'var(--vscode-descriptionForeground)',
            cursor: 'pointer',
            '&:hover': {
                backgroundColor: 'transparent',
                color: 'var(--vscode-foreground)',
            },
            '&:focus': {
                outline: 'none',
            },
        },
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
        padding: '0px',
        width: '24px',
        height: '24px',
        flexShrink: 0,
        borderRadius: '6px',
        '&:disabled': {
            backgroundColor: 'transparent',
        },
        ':focus-visible': {
            outlineStyle: 'none',
        },
        ...(createCustomFocusIndicatorStyle(
            {
                outline: '1px solid var(--vscode-focusBorder)',
                outlineOffset: '1px',
                boxShadow: 'none !important' as never,
                borderColor: 'transparent',
                borderRadius: '6px',
            },
            { customizeSelector: (s) => `${s}${s}${s}` },
        ) as Record<string, unknown>),
    },
    closeButton: {
        position: 'absolute',
        top: '4px',
        right: '4px',
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
        ':focus-visible': {
            outlineStyle: 'none',
        },
        ...(createCustomFocusIndicatorStyle(
            {
                outline: '1px solid var(--vscode-focusBorder)',
                outlineOffset: '0px',
                boxShadow: 'none',
                borderColor: 'transparent',
                borderRadius: '3px',
            },
            { customizeSelector: (s) => `${s}${s}` },
        ) as Record<string, unknown>),
    },
    confirmBanner: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 10px',
        backgroundColor: 'var(--vscode-editorWidget-background)',
        border: '1px solid var(--vscode-editorWidget-border, var(--vscode-contrastBorder, transparent))',
        borderRadius: '4px',
        fontSize: '12px',
        color: 'var(--vscode-editor-foreground)',
    },
    confirmMessage: {
        flex: 1,
    },
    confirmButtons: {
        display: 'flex',
        gap: '4px',
        flexShrink: 0,
    },
    confirmButton: {
        padding: '2px 8px',
        minWidth: 'auto',
        fontSize: '11px',
    },
    screenReaderOnly: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: '0',
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: '0',
    },
});

const gradientSteps = [
    { dash: 18, opacity: 0.06 },
    { dash: 16, opacity: 0.08 },
    { dash: 14, opacity: 0.12 },
    { dash: 12, opacity: 0.18 },
    { dash: 10, opacity: 0.25 },
    { dash: 8, opacity: 0.35 },
    { dash: 6, opacity: 0.5 },
    { dash: 4, opacity: 0.7 },
    { dash: 2, opacity: 1.0 },
];

// Pure CSS solution yielded rotating highlight with non-constant speed so we use this svg method.
const ProgressBorder = ({ width, height }: { width: number; height: number }) => (
    <svg
        style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width,
            height,
            pointerEvents: 'none',
            zIndex: 2,
        }}
    >
        {gradientSteps.map(({ dash, opacity }, i) => (
            <rect
                key={i}
                x={1}
                y={1}
                width={width - 2}
                height={height - 2}
                rx={6}
                ry={6}
                fill="none"
                stroke="var(--vscode-focusBorder, #007fd4)"
                strokeWidth={1.5}
                pathLength={100}
                strokeDasharray={`${dash} ${100 - dash}`}
                opacity={opacity}
                style={{ animation: 'dash-spin 3s linear infinite' }}
            />
        ))}
    </svg>
);

export const GenerateQueryInput = () => {
    const styles = useStyles();
    const { trpcClient } = useTrpcClient<QueryEditorAppRouter>();
    const state = useQueryEditorState();
    const dispatch = useQueryEditorStateDispatch();
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [lineCount, setLineCount] = useState(1);
    const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
    const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
    const [feedbackGiven, setFeedbackGiven] = useState<'up' | 'down' | null>(null);
    const [hadGenerated, setHadGenerated] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);

    // confirmToolInvocation message is pushed from the extension via the shared event subscription
    const confirmMessage = state.confirmToolInvocationMessage;
    const setConfirmMessage = (message: string | null) => {
        dispatch({ type: 'setConfirmToolInvocationMessage', message });
    };

    // Prompt history for arrow up/down navigation
    const promptHistory = usePromptHistory({ maxSize: 50 });
    const { addToHistory } = promptHistory;

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

    // Fetch available models when input becomes visible
    useEffect(() => {
        if (state.showGenerateInput) {
            void trpcClient.queryEditor.getAvailableModels.query().then((result) => {
                if (result) {
                    setAvailableModels(result.models);
                    if (result.savedModelId && result.models.some((m) => m.id === result.savedModelId)) {
                        setSelectedModelId(result.savedModelId);
                    } else if (result.models.length > 0) {
                        setSelectedModelId(result.models[0].id);
                    }
                }
            });
        }
    }, [state.showGenerateInput, trpcClient]);

    // Focus the textarea when the input becomes visible
    useEffect(() => {
        if (state.showGenerateInput && textareaRef.current) {
            textareaRef.current.focus();
        }
    }, [state.showGenerateInput]);

    // Clear focus highlight when loading starts (textarea gets disabled)
    useEffect(() => {
        if (isLoading) {
            setIsFocused(false);
        }
    }, [isLoading]);

    // Inject CSS @keyframes for the rotating border animation
    useEffect(() => {
        const styleId = 'generate-query-dash-spin';
        let style = document.getElementById(styleId) as HTMLStyleElement | null;
        if (!style) {
            style = document.createElement('style');
            style.id = styleId;
            document.head.appendChild(style);
        }
        style.textContent = ['@keyframes dash-spin {', '  to { stroke-dashoffset: -100; }', '}'].join('\n');
    }, []);

    // Measure container size for SVG border overlay
    useEffect(() => {
        const el = containerRef.current;
        if (!el || !isLoading) {
            setContainerSize(null);
            return;
        }
        const update = () => {
            const rect = el.getBoundingClientRect();
            setContainerSize({ width: rect.width, height: rect.height });
        };
        update();
        const observer = new ResizeObserver(() => update());
        observer.observe(el);
        return () => observer.disconnect();
    }, [isLoading]);

    // Handle model selection change
    const handleModelChange = useCallback(
        (data: OptionOnSelectData) => {
            const modelId = data.optionValue as string;
            setSelectedModelId(modelId);
            // Persist the selection
            void trpcClient.queryEditor.setSelectedModel.mutate({ modelId });
        },
        [trpcClient],
    );

    if (!state.showGenerateInput) {
        return null;
    }

    const handleClose = () => {
        if (isLoading) {
            handleCancel();
        }
        const hadEnteredPrompt = !!input.trim();
        setConfirmMessage(null);
        setFeedbackGiven(null);
        setInput('');
        setLineCount(1);
        void trpcClient.queryEditor.closeGenerateInput.mutate({
            hadEnteredPrompt,
            hadExecutedGenerateQuery: hadGenerated,
        });
        setHadGenerated(false);
        dispatch({ type: 'toggleGenerateInput' });
    };

    const handleSend = async () => {
        if (!input.trim()) {
            return;
        }

        setIsLoading(true);
        setFeedbackGiven(null);
        try {
            // Get the current query content from the state
            const currentQuery = state.queryValue;
            const submittedPrompt = input;

            // Send command to extension via tRPC and get result back
            const result = await trpcClient.queryEditor.generateQuery.mutate({
                prompt: submittedPrompt,
                currentQuery,
            });

            setIsLoading(false);
            setConfirmMessage(null);

            if (result && typeof result.generatedQuery === 'string') {
                setHadGenerated(true);
                // Insert generated query into the editor
                dispatch({ type: 'insertText', queryValue: result.generatedQuery });
                void trpcClient.queryEditor.updateQueryText.mutate({ query: result.generatedQuery });

                // Save prompt to history and clear input
                addToHistory(submittedPrompt);
                setInput('');
                setLineCount(1);
            }
        } catch (error) {
            console.error('Failed to generate query:', error);
            setIsLoading(false);
            setConfirmMessage(null);
        }
    };

    const handleCancel = () => {
        // Send cancel command to extension via tRPC
        void trpcClient.queryEditor.cancelGenerateQuery.mutate();
        setConfirmMessage(null);
        setIsLoading(false);
    };

    const handleConfirmResponse = (confirmed: boolean) => {
        setConfirmMessage(null);
        void trpcClient.queryEditor.confirmToolInvocationResponse.mutate({ confirmed });
    };

    const handleFeedback = (direction: 'up' | 'down') => {
        setFeedbackGiven(direction);
        void trpcClient.queryEditor.reportFeedback.mutate({
            feedbackValue: direction,
            component: 'generateQueryInput',
        });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleClose();
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
        <div ref={containerRef} className={mergeClasses(styles.container, isFocused && styles.containerFocused)}>
            {isLoading && containerSize && <ProgressBorder width={containerSize.width} height={containerSize.height} />}
            <div className={styles.innerContent}>
                <Button
                    className={styles.closeButton}
                    icon={<Dismiss12Regular />}
                    onClick={handleClose}
                    title={l10n.t('Close')}
                    aria-label={l10n.t('Close')}
                    appearance="transparent"
                    size="small"
                />
                <textarea
                    ref={textareaRef}
                    className={styles.textarea}
                    aria-label={l10n.t('Describe your query in natural language')}
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
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    onKeyDown={handleKeyDown}
                    disabled={isLoading}
                    rows={1}
                    style={{ height: `${Math.max(1, lineCount) * 17}px` }}
                />
                <div className={styles.screenReaderOnly} aria-live="polite" aria-atomic="true">
                    {isLoading ? l10n.t('Generating query...') : ''}
                </div>
                {confirmMessage ? (
                    <div className={styles.confirmBanner} role="alertdialog" aria-describedby="confirm-msg">
                        <span id="confirm-msg" className={styles.confirmMessage}>
                            {confirmMessage}
                        </span>
                        <div className={styles.confirmButtons}>
                            <Button
                                className={styles.confirmButton}
                                icon={<CheckmarkFilled />}
                                appearance="primary"
                                size="small"
                                onClick={() => handleConfirmResponse(true)}
                                aria-describedby="confirm-msg"
                            >
                                {l10n.t('Allow')}
                            </Button>
                            <Button
                                className={styles.confirmButton}
                                icon={<DismissFilled />}
                                appearance="subtle"
                                size="small"
                                onClick={() => handleConfirmResponse(false)}
                                aria-describedby="confirm-msg"
                            >
                                {l10n.t('Deny')}
                            </Button>
                        </div>
                    </div>
                ) : null}
                {!confirmMessage && (
                    <div className={styles.footer}>
                        <div className={styles.modelSection}>
                            {availableModels.length > 1 ? (
                                <Combobox
                                    className={styles.modelDropdown}
                                    style={{ width: `${modelDisplayName.length * 0.8}ch` }}
                                    onOptionSelect={(_event, data) => handleModelChange(data)}
                                    size="small"
                                    appearance="filled-lighter"
                                    value={modelDisplayName}
                                    selectedOptions={selectedModelId ? [selectedModelId] : []}
                                    disabled={isLoading}
                                    freeform={false}
                                    positioning={{ autoSize: false }}
                                    listbox={{
                                        style: {
                                            maxHeight: '280px',
                                            overflowY: 'auto',
                                        },
                                    }}
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
                                </Combobox>
                            ) : (
                                <div className={styles.modelLabel}>{modelDisplayName}</div>
                            )}
                            {state.isSurveyCandidate && (
                                <div
                                    className={styles.feedbackButtons}
                                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                                    role="group"
                                    aria-label={l10n.t('Rate this response')}
                                >
                                    <Button
                                        className={styles.feedbackButton}
                                        icon={
                                            feedbackGiven === 'up' ? (
                                                <ThumbLikeFilled fontSize={16} />
                                            ) : (
                                                <ThumbLikeRegular fontSize={16} />
                                            )
                                        }
                                        onClick={() => handleFeedback('up')}
                                        title={l10n.t('Like this response')}
                                        aria-label={l10n.t('Like this response')}
                                        appearance="transparent"
                                        size="small"
                                        disabled={feedbackGiven !== null}
                                    />
                                    <Button
                                        className={styles.feedbackButton}
                                        icon={
                                            feedbackGiven === 'down' ? (
                                                <ThumbDislikeFilled fontSize={16} />
                                            ) : (
                                                <ThumbDislikeRegular fontSize={16} />
                                            )
                                        }
                                        onClick={() => handleFeedback('down')}
                                        title={l10n.t('Dislike this response')}
                                        aria-label={l10n.t('Dislike this response')}
                                        appearance="transparent"
                                        size="small"
                                        disabled={feedbackGiven !== null}
                                    />
                                </div>
                            )}
                        </div>
                        <Button
                            className={styles.button}
                            icon={isLoading ? <RecordStopFilled /> : <SendFilled />}
                            onClick={isLoading ? handleCancel : () => void handleSend()}
                            disabled={!isLoading && !input.trim()}
                            title={isLoading ? l10n.t('Cancel generation') : l10n.t('Generate query')}
                            aria-label={isLoading ? l10n.t('Cancel generation') : l10n.t('Generate query')}
                            appearance={isLoading ? 'transparent' : 'primary'}
                            size="small"
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
