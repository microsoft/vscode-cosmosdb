/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Badge,
    Button,
    Checkbox,
    Dropdown,
    Field,
    Input,
    Label,
    Link,
    makeStyles,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Option,
    OptionGroup,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    ProgressBar,
    Radio,
    RadioGroup,
    Spinner,
    SplitButton,
    Text,
    Textarea,
    Tooltip,
    useAnnounce,
    type ButtonProps,
    type MenuButtonProps,
    type OptionOnSelectData,
    type SplitButtonProps,
} from '@fluentui/react-components';
import {
    AddRegular,
    ArrowClockwiseRegular,
    ChatRegular,
    CheckmarkCircleFilled,
    ChevronDownRegular,
    ChevronRightRegular,
    CircleRegular,
    CloudAddRegular,
    DatabaseRegular,
    DismissCircleRegular,
    DismissRegular,
    DocumentRegular,
    ErrorCircleFilled,
    InfoRegular,
    LockClosedRegular,
    PlayRegular,
    PlugConnectedRegular,
    SparkleRegular,
    StopRegular,
    WarningRegular,
} from '@fluentui/react-icons';
import { useTrpcClient } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useId, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { type MigrationAppRouter } from '../../../panels/trpc/appRouter';
import { sanitizeCosmosDBAccountName, validateCosmosDBAccountName } from '../../../utils/cosmosDBAccountName';
import { formatTokenCount, isAutoModel, partitionModelsByCapability } from '../../../utils/modelUtils';
import { CosmosDBIcon } from '../../icons/CosmosDBIcon';
import { BaseContextProvider, type DispatchToastFn } from '../../utils/context/BaseContextProvider';
import { ErrorBoundary } from '../../utils/ErrorBoundary';
import {
    isCodeMigrationReady,
    isDiscoveryLaunchReady,
    isMigrationRunActive,
    type MigrationRunActivity,
} from './state/deriveMigrationPhaseStates';
import { MigrationChannel } from './state/MigrationChannel';
import {
    useMigrationDispatch,
    useMigrationState,
    WithMigrationContext,
    type ModelInfo,
    type PhaseState,
} from './state/MigrationContext';

const tooltipParagraphStyle = { margin: '0 0 8px 0' };
const tooltipParagraphLastStyle = { margin: 0 };

const useStyles = makeStyles({
    actionGroup: {
        display: 'inline-flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '4px',
        verticalAlign: 'middle',
    },
    actionLabel: {
        position: 'relative',
        display: 'inline-block',
        minWidth: '72px',
    },
    actionStatus: {
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        whiteSpace: 'nowrap',
    },
    root: {
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'auto',
        scrollPaddingBottom: '64px',
        padding: '12px',
        paddingBottom: '52px',
        gap: '10px',
        boxSizing: 'border-box',
    },
    previewRail: {
        // Zero-height sticky rail that carries the floating Preview chip. With no height (only a
        // negative margin to cancel the column gap) it sits exactly at the panel's top edge and
        // does not move the panel below it. Stays pinned to the top while the assistant scrolls.
        position: 'sticky',
        top: 0,
        zIndex: 10,
        alignSelf: 'stretch',
        height: 0,
        marginBottom: '-10px',
        display: 'flex',
        justifyContent: 'flex-end',
        pointerEvents: 'none',
    },
    previewBadge: {
        // 8px from the panel's top and right borders (the rail's origin is the panel's top-right).
        pointerEvents: 'auto',
        marginTop: '8px',
        marginRight: '8px',
        cursor: 'default',
        height: '32px',
        paddingLeft: '20px',
        paddingRight: '20px',
        borderRadius: '6px',
        fontWeight: 600,
        // Lighter background + subtle panel-colored border + shadow so it reads as a floating chip.
        backgroundColor: 'var(--vscode-editorWidget-background)',
        color: 'var(--vscode-foreground)',
        border: '1px solid var(--vscode-panel-border)',
        boxShadow: '0 2px 8px var(--vscode-widget-shadow)',
        '&:focus-visible': {
            outline: '2px solid var(--vscode-focusBorder)',
            outlineOffset: '1px',
        },
    },
    configSection: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '12px',
        borderRadius: '6px',
        border: '1px solid var(--vscode-panel-border)',
        backgroundColor: 'var(--vscode-editor-background)',
    },
    configRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap',
    },
    buttonRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap',
    },
    stepContent: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '4px 0 4px 24px',
    },
    detailsColumns: {
        display: 'flex',
        gap: '24px',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        containerType: 'inline-size',
    },
    analysisPanel: {
        flex: '1 1 280px',
        minWidth: '0',
    },
    filePickerGrid: {
        display: 'grid',
        // Trailing 1fr track absorbs any extra width so the spanning expander row stretches with the grid.
        gridTemplateColumns: 'max-content max-content max-content max-content 1fr',
        gap: '6px 8px',
        alignItems: 'center',
        flex: '0 0 auto',
        // When the analysis panel wraps below, give the grid the full container width so expanders fill the row.
        '@container (max-width: 720px)': {
            flex: '1 1 100%',
        },
    },
    filePickerExpanderRow: {
        gridColumn: '1 / -1',
        paddingLeft: '12px',
        // `contain: inline-size` stops the (potentially long) file paths from contributing to the grid's column track widths; the row sizes to the grid instead and the paths ellipsize.
        contain: 'inline-size',
        minWidth: 0,
        overflow: 'hidden',
    },
    fileList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        paddingLeft: '6px',
        fontSize: '12px',
        color: 'var(--vscode-descriptionForeground)',
    },
    fileLink: {
        fontSize: '12px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'baseline',
        paddingLeft: '8px',
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
    },
    filePathDir: {
        color: 'var(--vscode-descriptionForeground)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        minWidth: 0,
        flex: '0 1 auto',
    },
    filePathDirTail: {
        color: 'var(--vscode-descriptionForeground)',
        whiteSpace: 'nowrap',
        flex: '0 0 auto',
    },
    filePathName: {
        flex: '0 0 auto',
        whiteSpace: 'nowrap',
    },
    fileRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
    },
    fileRowExcluded: {
        opacity: 0.5,
    },
    fileLinkExcluded: {
        textDecoration: 'line-through',
    },
    fileRemoveButton: {
        minWidth: 'auto',
    },
    fileRemoveButtonPlaceholder: {
        // Match the icon-only small Button footprint so protected rows stay aligned with removable rows.
        width: '24px',
        height: '24px',
        flex: '0 0 auto',
    },
    fileExpander: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        cursor: 'pointer',
        fontSize: '12px',
        color: 'var(--vscode-descriptionForeground)',
        userSelect: 'none',
    },
    infoIcon: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        verticalAlign: 'middle',
        marginLeft: '4px',
        fontSize: '16px',
        color: 'var(--vscode-foreground)',
        background: 'none',
        border: 'none',
        padding: '0',
        borderRadius: '4px',
        outline: 'none',
        '&:focus-visible': {
            outlineWidth: '2px',
            outlineStyle: 'solid',
            outlineColor: 'var(--vscode-focusBorder)',
            outlineOffset: '1px',
        },
    },
    infoPopoverSurface: {
        maxWidth: '360px',
    },
    analysisResult: {
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: '6px 8px',
        alignItems: 'center',
        fontSize: '12px',
    },
    analysisValue: {
        color: 'var(--vscode-descriptionForeground)',
    },
    footer: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        borderTop: '1px solid var(--vscode-panel-border)',
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'var(--vscode-editor-background)',
        zIndex: 1,
    },
    footerRight: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px',
    },
    completedContent: {
        opacity: 0.8,
    },
    phaseInputs: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
    },
    progressRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    sectionDivider: {
        borderTop: '1px solid var(--vscode-panel-border)',
        paddingTop: '8px',
        marginTop: '2px',
    },
    phaseDivider: {
        borderTop: '1px solid var(--vscode-panel-border)',
    },
    errorText: {
        color: 'var(--vscode-errorForeground)',
        fontSize: '12px',
    },
    warningText: {
        color: 'var(--vscode-editorWarning-foreground)',
        fontSize: '12px',
    },
    tokenBudgetContainer: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
    },
    tokenBudgetTrack: {
        position: 'relative',
        width: '120px',
        height: '6px',
        borderRadius: '3px',
        backgroundColor: 'var(--vscode-panel-border)',
        flexShrink: '0',
        overflow: 'hidden',
    },
    tokenBudgetFill: {
        position: 'absolute',
        top: '0',
        left: '0',
        height: '100%',
        borderRadius: '3px',
        transitionProperty: 'width, background-color',
        transitionDuration: '0.3s',
        transitionTimingFunction: 'ease',
    },
    tokenBudgetFillAnimating: {
        animationName: {
            '0%': { opacity: '1' },
            '50%': { opacity: '0.35' },
            '100%': { opacity: '1' },
        },
        animationDuration: '1.5s',
        animationTimingFunction: 'ease-in-out',
        animationIterationCount: 'infinite',
    },
});

function TokenBudgetBar({
    estimate,
    isEstimating,
}: {
    estimate: { minTokens: number; maxTokens: number; modelMaxTokens: number } | null;
    isEstimating: boolean;
}) {
    const styles = useStyles();

    if (!isEstimating && !estimate) return null;

    const fillPercent = estimate ? Math.min(estimate.minTokens / estimate.modelMaxTokens, 1) * 100 : 0;

    let barColor: string;
    let textColor: string;
    if (!estimate) {
        barColor = 'var(--vscode-descriptionForeground)';
        textColor = 'var(--vscode-descriptionForeground)';
    } else if (estimate.minTokens > estimate.modelMaxTokens) {
        barColor = 'var(--vscode-errorForeground)';
        textColor = 'var(--vscode-errorForeground)';
    } else if (estimate.minTokens >= estimate.modelMaxTokens * 0.75 || estimate.maxTokens > estimate.modelMaxTokens) {
        barColor = 'var(--vscode-editorWarning-foreground)';
        textColor = 'var(--vscode-editorWarning-foreground)';
    } else {
        barColor = 'var(--vscode-testing-iconPassed)';
        textColor = 'var(--vscode-descriptionForeground)';
    }

    const tokenText = estimate
        ? l10n.t(
              '~{0}\u2013{1} / {2} tokens',
              formatTokenCount(estimate.minTokens),
              formatTokenCount(estimate.maxTokens),
              formatTokenCount(estimate.modelMaxTokens),
          )
        : l10n.t('Estimating tokens\u2026');

    return (
        <div className={styles.tokenBudgetContainer}>
            <div className={styles.tokenBudgetTrack}>
                <div
                    className={
                        isEstimating
                            ? `${styles.tokenBudgetFill} ${styles.tokenBudgetFillAnimating}`
                            : styles.tokenBudgetFill
                    }
                    style={{ width: `${fillPercent}%`, backgroundColor: barColor }}
                />
            </div>
            <Text
                size={200}
                style={{
                    color: textColor,
                    opacity: isEstimating ? 0.6 : 1,
                    transition: 'opacity 0.3s',
                }}
            >
                {tokenText}
            </Text>
        </div>
    );
}

function MigrationActionButton({
    activity,
    compact = false,
    actionLabel,
    onOpenChat,
    onReload,
    onConfirmStopped,
    children,
    ...buttonProps
}: Omit<Extract<ButtonProps, { as?: 'button' }>, 'children'> & {
    children?: string;
    activity: MigrationRunActivity | null;
    compact?: boolean;
    actionLabel: string;
    onOpenChat: () => void;
    onReload: () => void;
    onConfirmStopped: () => void;
}) {
    const styles = useStyles();
    const { announce } = useAnnounce();
    const [recoveryOpen, setRecoveryOpen] = useState(false);
    const [menuTarget, setMenuTarget] = useState<HTMLElement | null>(null);
    const active = isMigrationRunActive(activity);
    const [idleLabel, setIdleLabel] = useState(children);
    useEffect(() => {
        if (!active) setIdleLabel(() => children);
    }, [active, children]);
    const statusLabel =
        activity?.activity === 'waiting-for-decision'
            ? l10n.t('Needs input')
            : activity?.activity === 'unknown'
              ? l10n.t('Check Chat')
              : activity?.activity === 'running'
                ? l10n.t('Running...')
                : activity?.activity === 'launching'
                  ? l10n.t('Opening...')
                  : l10n.t('In Chat');
    const openChatLabel = l10n.t('Open Chat');
    const resetStatusLabel = l10n.t('Reset Status');
    const statusDescription = active
        ? `${actionLabel}. ${statusLabel} ${resetStatusLabel}. ${l10n.t('This only resets local tracking; it does not stop the agent in Chat.')}${activity?.detail ? ` ${activity.detail}` : ''}`
        : (buttonProps['aria-description'] ?? actionLabel);
    useEffect(() => {
        if (active) announce(`${actionLabel}. ${statusLabel}`);
    }, [active, actionLabel, statusLabel, announce]);
    const icon =
        activity?.activity === 'waiting-for-decision' || activity?.activity === 'waiting-for-agent' ? (
            <ChatRegular />
        ) : activity?.activity === 'unknown' ? (
            <WarningRegular />
        ) : (
            <Spinner size="extra-tiny" appearance="inverted" aria-hidden="true" />
        );
    const button = (
        <Button
            {...buttonProps}
            ref={setMenuTarget}
            icon={active ? icon : buttonProps.icon}
            disabled={active ? false : buttonProps.disabled}
            onClick={active ? onConfirmStopped : buttonProps.onClick}
            onContextMenu={(event) => {
                if (active && compact) {
                    event.preventDefault();
                    setRecoveryOpen(true);
                } else {
                    buttonProps.onContextMenu?.(event);
                }
            }}
            onKeyDown={(event) => {
                buttonProps.onKeyDown?.(event);
                if (active && compact && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
                    event.preventDefault();
                    setRecoveryOpen(true);
                }
            }}
            aria-label={
                active
                    ? children
                        ? `${statusLabel} ${resetStatusLabel}. ${actionLabel}`
                        : `${resetStatusLabel}. ${actionLabel}`
                    : buttonProps['aria-label']
            }
            aria-description={active ? statusDescription : buttonProps['aria-description']}
        >
            {children && (
                <span className={styles.actionLabel}>
                    <span style={{ visibility: active ? 'hidden' : undefined }} aria-hidden={active || undefined}>
                        {active ? idleLabel : children}
                    </span>
                    {active && <span className={styles.actionStatus}>{statusLabel}</span>}
                </span>
            )}
        </Button>
    );
    return (
        <span
            className={styles.actionGroup}
            style={buttonProps.style?.width === '100%' ? { width: '100%' } : undefined}
            data-testid={active ? 'migration-run-activity' : undefined}
            data-activity={active ? activity?.activity : undefined}
        >
            {active && compact ? (
                <Menu
                    open={recoveryOpen}
                    positioning={{ target: menuTarget ?? undefined }}
                    onOpenChange={(_event, data) => {
                        setRecoveryOpen(data.open);
                        if (!data.open) menuTarget?.focus();
                    }}
                >
                    <Tooltip content={statusDescription} relationship="description" withArrow>
                        {button}
                    </Tooltip>
                    <MenuPopover>
                        <MenuList>
                            <MenuItem icon={<ChatRegular />} onClick={onOpenChat}>
                                {openChatLabel}
                            </MenuItem>
                            <MenuItem icon={<ArrowClockwiseRegular />} onClick={onReload}>
                                {l10n.t('Refresh Status')}
                            </MenuItem>
                            <MenuItem icon={<CheckmarkCircleFilled />} onClick={onConfirmStopped}>
                                {l10n.t('Confirm Stopped')}
                            </MenuItem>
                        </MenuList>
                    </MenuPopover>
                </Menu>
            ) : (
                <Tooltip content={statusDescription} relationship="description" withArrow>
                    {button}
                </Tooltip>
            )}
            {active && !compact && (
                <>
                    <Tooltip content={l10n.t('Refresh Status')} relationship="description">
                        <Button
                            size="small"
                            icon={<ArrowClockwiseRegular />}
                            aria-label={l10n.t('Refresh Status')}
                            onClick={onReload}
                        />
                    </Tooltip>
                    <Button size="small" icon={<CheckmarkCircleFilled />} onClick={onConfirmStopped}>
                        {l10n.t('Confirm Stopped')}
                    </Button>
                </>
            )}
        </span>
    );
}

function FileListExpander({
    files,
    excludedFiles,
    workspacePath,
    onOpenFile,
    onRemoveFile,
    onRestoreFile,
    protectedFileName,
    disabled,
    styles,
}: {
    files: string[];
    excludedFiles: string[];
    workspacePath: string;
    onOpenFile: (filePath: string) => void;
    onRemoveFile: (filePath: string) => void;
    onRestoreFile: (filePath: string) => void;
    protectedFileName?: string;
    disabled?: boolean;
    styles: ReturnType<typeof useStyles>;
}) {
    const [expanded, setExpanded] = useState(false);
    if (files.length === 0 && excludedFiles.length === 0) return null;

    const splitPath = (absolutePath: string): { dir: string; name: string } => {
        const normalized = absolutePath.replace(/\\/g, '/');
        const wsNormalized = workspacePath.replace(/\\/g, '/');
        const relative =
            wsNormalized && (normalized === wsNormalized || normalized.startsWith(wsNormalized + '/'))
                ? normalized.slice(wsNormalized.length + 1)
                : normalized;
        const lastSep = relative.lastIndexOf('/');
        if (lastSep < 0) return { dir: '', name: relative };
        // Keep the separator on the name side so it stays visually anchored next to
        // the file name even when the directory portion ellipsis (avoids the
        // trailing slash being bidi-reordered inside the RTL dir span).
        return { dir: relative.slice(0, lastSep), name: relative.slice(lastSep) };
    };

    const renderPath = (absolutePath: string, extraClass?: string) => {
        const { dir, name } = splitPath(absolutePath);
        const cleanName = name.startsWith('/') ? name.slice(1) : name;
        const fullRelative = dir ? `${dir}/${cleanName}` : cleanName;
        // Split the directory so the deepest folder always stays visible next to the file name
        // while earlier segments ellipsis at the end (effectively a middle ellipsis on the full path).
        let dirHead = '';
        let dirTail = '';
        if (dir) {
            const lastSep = dir.lastIndexOf('/');
            if (lastSep < 0) {
                dirTail = dir;
            } else {
                dirHead = dir.slice(0, lastSep);
                dirTail = dir.slice(lastSep);
            }
        }
        return (
            <>
                {dirHead && (
                    <span className={`${styles.filePathDir}${extraClass ? ' ' + extraClass : ''}`} title={fullRelative}>
                        {dirHead}
                    </span>
                )}
                {dirTail && (
                    <span
                        className={`${styles.filePathDirTail}${extraClass ? ' ' + extraClass : ''}`}
                        title={fullRelative}
                    >
                        {dirTail}
                    </span>
                )}
                <span className={`${styles.filePathName}${extraClass ? ' ' + extraClass : ''}`} title={fullRelative}>
                    {name}
                </span>
            </>
        );
    };

    const basename = (absolutePath: string) => {
        const { name } = splitPath(absolutePath);
        return name.startsWith('/') ? name.slice(1) : name;
    };

    return (
        <div>
            <div
                className={styles.fileExpander}
                onClick={() => setExpanded(!expanded)}
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- styled <div> expander; switching to <button> would break layout
                role="button"
                aria-expanded={expanded}
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === ' ') {
                        e.preventDefault();
                        setExpanded(!expanded);
                    } else if (e.key === 'Enter') {
                        setExpanded(!expanded);
                    }
                }}
            >
                {expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
                <Text size={200}>{l10n.t('{count} file(s) selected', { count: files.length })}</Text>
            </div>
            {expanded && (
                <div className={styles.fileList}>
                    {files.map((f: string) => {
                        const name = basename(f);
                        return (
                            <div key={`a-${f}`} className={styles.fileRow}>
                                <Link className={styles.fileLink} onClick={() => onOpenFile(f)}>
                                    {renderPath(f)}
                                </Link>
                                {name !== protectedFileName ? (
                                    <Tooltip content={l10n.t('Exclude file')} relationship="description" withArrow>
                                        <Button
                                            appearance="subtle"
                                            size="small"
                                            className={styles.fileRemoveButton}
                                            icon={<DismissRegular />}
                                            aria-label={l10n.t('Exclude file {0}', name)}
                                            disabled={disabled}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRemoveFile(f);
                                            }}
                                        />
                                    </Tooltip>
                                ) : (
                                    <span className={styles.fileRemoveButtonPlaceholder} aria-hidden="true" />
                                )}
                            </div>
                        );
                    })}
                    {excludedFiles.map((f: string) => {
                        const name = basename(f);
                        return (
                            <div key={`x-${f}`} className={`${styles.fileRow} ${styles.fileRowExcluded}`}>
                                <Link
                                    className={`${styles.fileLink} ${styles.fileLinkExcluded}`}
                                    onClick={() => onOpenFile(f)}
                                >
                                    {renderPath(f, styles.fileLinkExcluded)}
                                </Link>
                                <Tooltip content={l10n.t('Include file')} relationship="description" withArrow>
                                    <Button
                                        appearance="subtle"
                                        size="small"
                                        className={styles.fileRemoveButton}
                                        icon={<AddRegular />}
                                        aria-label={l10n.t('Include file {0}', name)}
                                        disabled={disabled}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onRestoreFile(f);
                                        }}
                                    />
                                </Tooltip>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function InfoTooltipIcon({
    content,
    ariaLabel,
    styles,
}: {
    content: ReactNode;
    ariaLabel: string;
    styles: ReturnType<typeof useStyles>;
}) {
    const contentSlot = useMemo(() => ({ children: content }), [content]);
    return (
        <Tooltip content={contentSlot} relationship="description" withArrow>
            <button type="button" aria-label={ariaLabel} className={styles.infoIcon}>
                <InfoRegular />
            </button>
        </Tooltip>
    );
}

function InfoPopoverIcon({
    content,
    ariaLabel,
    styles,
}: {
    content: ReactNode;
    ariaLabel: string;
    styles: ReturnType<typeof useStyles>;
}) {
    return (
        <Popover withArrow>
            <PopoverTrigger>
                <button type="button" aria-label={ariaLabel} className={styles.infoIcon}>
                    <InfoRegular />
                </button>
            </PopoverTrigger>
            <PopoverSurface className={styles.infoPopoverSurface} aria-label={ariaLabel}>
                {content}
            </PopoverSurface>
        </Popover>
    );
}

function getPhaseIcon(state: PhaseState) {
    let icon: ReactElement;
    let label: string;
    switch (state) {
        case 'locked':
            icon = <LockClosedRegular />;
            label = l10n.t('Locked');
            break;
        case 'available':
            icon = <CircleRegular />;
            label = l10n.t('Available');
            break;
        case 'in-progress':
            icon = <PlayRegular />;
            label = l10n.t('In progress');
            break;
        case 'complete':
            icon = <CheckmarkCircleFilled style={{ color: 'var(--vscode-testing-iconPassed)' }} />;
            label = l10n.t('Complete');
            break;
        case 'error':
            icon = <ErrorCircleFilled style={{ color: 'var(--vscode-errorForeground)' }} />;
            label = l10n.t('Error');
            break;
    }
    return (
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- composite ARIA img: wraps Fluent SVG icon component which a native <img> cannot contain (no src/children semantics)
        <span role="img" aria-label={label} style={{ display: 'inline-flex' }}>
            {icon}
        </span>
    );
}

function ReferencedInCodeStatus({ isMapped }: { isMapped: boolean }): ReactElement {
    const label = isMapped ? l10n.t('Yes') : l10n.t('No');

    return (
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- composite ARIA img: wraps the visible status symbol which a native <img> cannot contain
        <span role="img" aria-label={label} style={{ display: 'inline-flex' }}>
            {isMapped ? (
                <CheckmarkCircleFilled aria-hidden={true} style={{ color: 'var(--vscode-testing-iconPassed)' }} />
            ) : (
                <Text aria-hidden={true} size={200} style={{ color: 'var(--vscode-descriptionForeground)' }}>
                    —
                </Text>
            )}
        </span>
    );
}

function MigrationAssistantInner({ channel }: { channel: MigrationChannel }) {
    const styles = useStyles();
    const analysisLabelId = useId();
    const state = useMigrationState();
    const dispatch = useMigrationDispatch();

    // Load project on mount
    useEffect(() => {
        void channel.postMessage({
            type: 'event',
            name: 'command',
            params: [{ commandName: 'loadProject', params: [] }],
        });
        void channel.postMessage({
            type: 'event',
            name: 'command',
            params: [{ commandName: 'getAvailableModels', params: [] }],
        });
        void channel.postMessage({
            type: 'event',
            name: 'command',
            params: [{ commandName: 'checkGitRepository', params: [] }],
        });
    }, [channel]);

    const sendCommand = useCallback(
        (commandName: string, ...params: unknown[]) => {
            void channel.postMessage({
                type: 'event',
                name: 'command',
                params: [{ commandName, params }],
            });
        },
        [channel],
    );

    // Derived phase states
    const isRunActive = isMigrationRunActive(state.runActivity);
    const runPhase =
        state.runActivity?.phase === 'all'
            ? (Object.values(state.phaseCompletion ?? {}).find((completion) => completion.status === 'in-progress')
                  ?.phase ?? 'preflight')
            : state.runActivity?.phase;
    const [openPhases, setOpenPhases] = useState(['phase1']);
    useEffect(() => {
        const phase = {
            discovery: 'phase1',
            assessment: 'phase2',
            'schema-conversion': 'phase3',
            provisioning: 'phase4',
        }[runPhase as 'discovery' | 'assessment' | 'schema-conversion' | 'provisioning'];
        if (isRunActive && phase) setOpenPhases((current) => (current.includes(phase) ? current : [...current, phase]));
    }, [isRunActive, runPhase]);
    const phase1State: PhaseState = state.discoveryState;
    const phase2State: PhaseState = state.assessmentState;
    const phase3State: PhaseState = state.schemaConversionState;
    const phase4State: PhaseState =
        state.provisioningState === 'complete'
            ? 'complete'
            : state.connectionTestState === 'complete'
              ? state.provisioningState === 'locked'
                  ? 'available'
                  : state.provisioningState
              : state.connectionTestState;

    const allComplete =
        !isRunActive &&
        (state.useProgrammaticFlow
            ? phase1State === 'complete' &&
              phase2State === 'complete' &&
              phase3State === 'complete' &&
              (!state.isPhase4Required || phase4State === 'complete')
            : isCodeMigrationReady(state.phaseCompletion)) &&
        state.consentGiven;
    const hasAllAnalysisFields = !!(
        state.analysisResult &&
        state.analysisResult.projectName?.trim() &&
        state.analysisResult.projectType?.trim() &&
        state.analysisResult.language?.trim() &&
        state.analysisResult.databaseType?.trim() &&
        state.analysisResult.databaseAccess?.trim()
    );
    const isDiscoveryDisabled =
        isRunActive ||
        (state.useProgrammaticFlow
            ? phase1State === 'locked' ||
              !hasAllAnalysisFields ||
              state.schemaFiles.length === 0 ||
              !state.consentGiven ||
              !state.isAIFeaturesEnabled
            : !isDiscoveryLaunchReady(state));
    const isAiActionDisabled = isRunActive || !state.consentGiven || !state.isAIFeaturesEnabled;
    const aiActionDisabledDescription = !state.consentGiven
        ? l10n.t('AI consent is required to use this action.')
        : !state.isAIFeaturesEnabled
          ? l10n.t('GitHub Copilot must be active to use this action.')
          : undefined;
    const generateSchemaLabel = l10n.t('Generate schema files from workspace code using AI');
    const updateVolumetricsLabel = l10n.t('Update volumetrics template using AI');
    const updateAccessPatternsLabel = l10n.t('Update access-patterns template using AI');
    const isPhase2Disabled = isRunActive || phase1State !== 'complete' || !hasAllAnalysisFields;
    const isPhase3Disabled = isRunActive || phase2State !== 'complete';
    const isPhase4Disabled = isRunActive || phase1State !== 'complete' || !hasAllAnalysisFields;

    // isEstimating: a request was sent for the current fileStateGeneration but the estimate hasn't caught up yet
    const isAutoSelected = state.selectedModelId === 'auto';
    const isEstimating =
        state.useProgrammaticFlow &&
        !isAutoSelected &&
        state.selectedModelId !== null &&
        state.isLoaded &&
        state.schemaFiles.length > 0 &&
        state.fileStateGeneration !== (state.tokenEstimate?.estimateGeneration ?? -1);

    // Request token estimation whenever schema/access-pattern/volumetric files or model change
    useEffect(() => {
        if (
            state.useProgrammaticFlow &&
            state.isLoaded &&
            state.schemaFiles.length > 0 &&
            state.selectedModelId &&
            !isAutoSelected
        ) {
            sendCommand('estimateContextTokens');
        }
    }, [
        state.isLoaded,
        state.schemaFiles.length,
        state.accessPatternFiles.length,
        state.volumetricFiles.length,
        state.fileStateGeneration,
        state.selectedModelId,
        state.useProgrammaticFlow,
        isAutoSelected,
        sendCommand,
    ]);

    // Handlers
    const handleProjectNameChange = useCallback(
        (value: string) => {
            dispatch({ type: 'SET_PROJECT_NAME', payload: value });
            sendCommand('updateProjectName', value);
        },
        [dispatch, sendCommand],
    );

    const handleModelChange = useCallback(
        (_e: unknown, data: OptionOnSelectData) => {
            const modelId = data.optionValue as string;
            dispatch({ type: 'SET_SELECTED_MODEL', payload: modelId });
            sendCommand('setSelectedModel', modelId);
        },
        [dispatch, sendCommand],
    );

    const handleConsentChange = useCallback(
        (_e: unknown, data: { checked: boolean | 'mixed' }) => {
            const consent = data.checked === true;
            dispatch({ type: 'SET_CONSENT', payload: consent });
            sendCommand('updateConsent', consent);
        },
        [dispatch, sendCommand],
    );

    const handleSelectSchemaFiles = useCallback(() => sendCommand('selectSchemaFiles'), [sendCommand]);
    const handleSelectSchemaFolder = useCallback(() => sendCommand('selectSchemaFolder'), [sendCommand]);
    const handleSelectVolumetricFiles = useCallback(() => sendCommand('selectVolumetricFiles'), [sendCommand]);
    const handleSelectVolumetricFolder = useCallback(() => sendCommand('selectVolumetricFolder'), [sendCommand]);
    const handleSelectAccessPatternFiles = useCallback(() => sendCommand('selectAccessPatternFiles'), [sendCommand]);
    const handleSelectAccessPatternFolder = useCallback(() => sendCommand('selectAccessPatternFolder'), [sendCommand]);
    const handleOpenVolumetricsTemplate = useCallback(() => sendCommand('openVolumetricsTemplate'), [sendCommand]);
    const handleOpenAccessPatternsTemplate = useCallback(
        () => sendCommand('openAccessPatternsTemplate'),
        [sendCommand],
    );
    const handleAnalyzeVolumetrics = useCallback(() => sendCommand('analyzeVolumetrics'), [sendCommand]);
    const handleAnalyzeAccessPatterns = useCallback(() => sendCommand('analyzeAccessPatterns'), [sendCommand]);
    const handleAnalyzeDatabaseSchema = useCallback(() => sendCommand('analyzeDatabaseSchema'), [sendCommand]);

    const handleAnalyze = useCallback(() => sendCommand('analyzeApplication'), [sendCommand]);
    const handleCancelAnalysis = useCallback(() => sendCommand('cancelAnalysis'), [sendCommand]);
    const handleRunDiscovery = useCallback(() => sendCommand('runDiscovery'), [sendCommand]);
    const handleCancelDiscovery = useCallback(() => sendCommand('cancelDiscovery'), [sendCommand]);
    const handleDiscoveryInstructionsChange = useCallback(
        (_e: unknown, data: { value: string }) => {
            dispatch({ type: 'SET_DISCOVERY_INSTRUCTIONS', payload: data.value });
            sendCommand('updateDiscoveryInstructions', data.value);
        },
        [dispatch, sendCommand],
    );

    const handleAssessmentInstructionsChange = useCallback(
        (_e: unknown, data: { value: string }) => {
            dispatch({ type: 'SET_ASSESSMENT_INSTRUCTIONS', payload: data.value });
            sendCommand('updateAssessmentInstructions', data.value);
        },
        [dispatch, sendCommand],
    );

    const handleSchemaConversionInstructionsChange = useCallback(
        (_e: unknown, data: { value: string }) => {
            dispatch({ type: 'SET_SCHEMA_CONVERSION_INSTRUCTIONS', payload: data.value });
            sendCommand('updateSchemaConversionInstructions', data.value);
        },
        [dispatch, sendCommand],
    );

    const handleAnalysisFieldChange = useCallback(
        (field: string, value: string) => {
            dispatch({ type: 'UPDATE_ANALYSIS_FIELD', payload: { field, value } });
            sendCommand('updateAnalysisResult', { [field]: value });
        },
        [dispatch, sendCommand],
    );

    const handleRunAssessment = useCallback(() => sendCommand('runAssessment'), [sendCommand]);

    const handleFrameworksChange = useCallback(
        (value: string) => {
            const frameworks = value
                .split(',')
                .map((framework) => framework.trim())
                .filter(Boolean);
            dispatch({ type: 'UPDATE_FRAMEWORKS', payload: frameworks });
            sendCommand('updateAnalysisResult', { frameworks });
        },
        [dispatch, sendCommand],
    );

    const handleCancelAssessment = useCallback(() => sendCommand('cancelAssessment'), [sendCommand]);
    const handleRunSchemaConversion = useCallback(
        () => sendCommand('runSchemaConversion', state.includeUnmappedDomains, state.thoroughAnalysis),
        [sendCommand, state.includeUnmappedDomains, state.thoroughAnalysis],
    );
    const handleCancelSchemaConversion = useCallback(() => sendCommand('cancelSchemaConversion'), [sendCommand]);
    const handleIncludeUnmappedDomainsChange = useCallback(
        (_e: unknown, data: { checked: boolean | 'mixed' }) => {
            dispatch({ type: 'SET_INCLUDE_UNMAPPED_DOMAINS', payload: data.checked === true });
        },
        [dispatch],
    );

    const handleThoroughAnalysisChange = useCallback(
        (_e: unknown, data: { checked: boolean | 'mixed' }) => {
            dispatch({ type: 'SET_THOROUGH_ANALYSIS', payload: data.checked === true });
        },
        [dispatch],
    );

    const handleTargetTypeChange = useCallback(
        (_e: unknown, data: { value: string }) => {
            const targetType = data.value as 'emulator' | 'azure' | 'provision';
            dispatch({ type: 'SET_TARGET_TYPE', payload: targetType });
            // Special-case `provision`: the reducer defaults `targetAccountName` to a
            // sanitized project-name-based suggestion when switching in for the first
            // time. Mirror that default to the backend so the next `provisionAccount`
            // call has an account name to work with even if the user never edited the
            // field.
            const accountName =
                targetType === 'provision'
                    ? (state.targetAccountName ?? sanitizeCosmosDBAccountName(state.projectName) ?? undefined)
                    : undefined;
            sendCommand('setTargetEnvironment', targetType, undefined, undefined, accountName);
        },
        [dispatch, sendCommand, state.targetAccountName, state.projectName],
    );

    const handleEndpointChange = useCallback(
        (value: string) => {
            dispatch({ type: 'SET_TARGET_ENDPOINT', payload: value });
            // Persist the endpoint into project.json. `setTargetEnvironment` merges
            // undefined fields, so resource group / account name / location are not
            // clobbered when the user edits only the endpoint.
            sendCommand('setTargetEnvironment', state.targetType, value);
        },
        [dispatch, sendCommand, state.targetType],
    );

    const handleTestConnection = useCallback(
        () => sendCommand('testConnection', state.targetType, state.targetEndpoint),
        [sendCommand, state.targetType, state.targetEndpoint],
    );

    const handleSelectAccount = useCallback(() => sendCommand('selectAccount'), [sendCommand]);

    const handlePopulateSampleData = useCallback(() => sendCommand('populateSampleData'), [sendCommand]);

    const handleProvisionAccount = useCallback(() => sendCommand('provisionAccount'), [sendCommand]);

    const handleSelectResourceGroup = useCallback(() => sendCommand('selectResourceGroup'), [sendCommand]);

    const handleLocationChange = useCallback(
        (_e: unknown, data: OptionOnSelectData) => {
            const location = data.optionValue;
            if (!location) return;
            dispatch({ type: 'SET_TARGET_LOCATION', payload: location });
            sendCommand('setTargetLocation', location);
        },
        [dispatch, sendCommand],
    );

    const handleAccountNameChange = useCallback(
        (value: string) => {
            dispatch({ type: 'SET_TARGET_ACCOUNT_NAME', payload: value });
            // Persist just the account name; other provision-mode fields are preserved
            // on the backend via merge so they are not overwritten with stale values.
            sendCommand('setTargetEnvironment', 'provision', undefined, undefined, value);
        },
        [dispatch, sendCommand],
    );

    const handleCancelProvisioning = useCallback(() => sendCommand('cancelProvisioning'), [sendCommand]);

    const handleCancelAccountProvisioning = useCallback(() => sendCommand('cancelAccountProvisioning'), [sendCommand]);

    // Validate the target account name against the Cosmos DB account-name rules.
    // Only surfaced while in 'provision' mode — for existing-account flows the name
    // comes from a picker and is always valid.
    const accountNameValidationError = useMemo(
        () =>
            state.targetType === 'provision' && state.targetAccountName
                ? validateCosmosDBAccountName(state.targetAccountName)
                : undefined,
        [state.targetType, state.targetAccountName],
    );

    const handleReset = useCallback(() => sendCommand('resetProject'), [sendCommand]);
    const handleCodeMigration = useCallback(
        () => sendCommand(state.codeMigrationAction === 'plan' ? 'planMigration' : 'migrateApplication'),
        [sendCommand, state.codeMigrationAction],
    );
    const handleSetCodeMigrationAction = useCallback(
        (action: 'plan' | 'migrate') => {
            dispatch({ type: 'SET_CODE_MIGRATION_ACTION', payload: action });
        },
        [dispatch],
    );

    const handleMigrationInstructionsChange = useCallback(
        (_e: unknown, data: { value: string }) => {
            dispatch({ type: 'SET_MIGRATION_INSTRUCTIONS', payload: data.value });
            sendCommand('updateMigrationInstructions', data.value);
        },
        [dispatch, sendCommand],
    );

    const handleInitGit = useCallback(() => sendCommand('initGitRepository'), [sendCommand]);
    const handleAddToGitignore = useCallback(() => sendCommand('addToGitignore'), [sendCommand]);
    const handleRemoveFromGitignore = useCallback(() => sendCommand('removeFromGitignore'), [sendCommand]);

    const handleOpenFile = useCallback((filePath: string) => sendCommand('openFile', filePath), [sendCommand]);
    const handleRevealInExplorer = useCallback(
        (filePath: string) => sendCommand('revealInExplorer', filePath),
        [sendCommand],
    );
    const handleRevealSchemaFolder = useCallback(
        () => handleRevealInExplorer(`${state.workspacePath}/.cosmosdb-migration/phases/1-discovery/schema-ddl`),
        [handleRevealInExplorer, state.workspacePath],
    );
    const handleRevealVolumetricsFolder = useCallback(
        () => handleRevealInExplorer(`${state.workspacePath}/.cosmosdb-migration/phases/1-discovery/volumetrics`),
        [handleRevealInExplorer, state.workspacePath],
    );
    const handleRevealAccessPatternsFolder = useCallback(
        () => handleRevealInExplorer(`${state.workspacePath}/.cosmosdb-migration/phases/1-discovery/access-patterns`),
        [handleRevealInExplorer, state.workspacePath],
    );
    const handleRemoveSchemaFile = useCallback(
        (filePath: string) => sendCommand('removeDiscoveryFile', 'schema-ddl', filePath),
        [sendCommand],
    );
    const handleRemoveVolumetricFile = useCallback(
        (filePath: string) => sendCommand('removeDiscoveryFile', 'volumetrics', filePath),
        [sendCommand],
    );
    const handleRemoveAccessPatternFile = useCallback(
        (filePath: string) => sendCommand('removeDiscoveryFile', 'access-patterns', filePath),
        [sendCommand],
    );
    const handleRestoreSchemaFile = useCallback(
        (filePath: string) => sendCommand('restoreDiscoveryFile', 'schema-ddl', filePath),
        [sendCommand],
    );
    const handleRestoreVolumetricFile = useCallback(
        (filePath: string) => sendCommand('restoreDiscoveryFile', 'volumetrics', filePath),
        [sendCommand],
    );
    const handleRestoreAccessPatternFile = useCallback(
        (filePath: string) => sendCommand('restoreDiscoveryFile', 'access-patterns', filePath),
        [sendCommand],
    );
    const handleOpenGeneratedBicep = useCallback(() => sendCommand('openGeneratedBicep'), [sendCommand]);
    const handlePreviewMarkdown = useCallback(
        (filePath: string) => sendCommand('previewMarkdown', filePath),
        [sendCommand],
    );

    const isFirstVisit = useMemo(
        () => phase1State !== 'complete' && phase2State !== 'complete',
        [phase1State, phase2State],
    );
    const [descriptionExpanded, setDescriptionExpanded] = useState(false);

    if (!state.isLoaded) {
        return (
            <div className={styles.root}>
                <ProgressBar />
            </div>
        );
    }

    const selectedModel =
        state.availableModels.find((m: ModelInfo) => m.id === state.selectedModelId) ?? state.availableModels[0];

    const run = state.runActivity;
    const actionActivity = (
        phase: MigrationRunActivity['phase'],
        step: string | null = null,
    ): MigrationRunActivity | null =>
        run &&
        runPhase === phase &&
        (phase !== 'preflight' || (run.step ?? 'application-details') === step) &&
        (phase !== 'provisioning' || (run.step ?? 'resources-and-data') === step)
            ? run
            : null;
    const chatActionProps = {
        onOpenChat: () => sendCommand('openMigrationChat'),
        onReload: () => sendCommand('loadProject'),
        onConfirmStopped: () => sendCommand('confirmMigrationStopped'),
    };

    return (
        <div className={styles.root}>
            {/* Floating Preview chip — pinned to the panel's top-right corner; stays put on scroll. */}
            <div className={styles.previewRail}>
                <Tooltip
                    content={l10n.t('Preview: features and behavior may change. Use with care.')}
                    relationship="description"
                >
                    <Badge
                        appearance="outline"
                        color="informative"
                        className={styles.previewBadge}
                        tabIndex={0}
                        aria-label={l10n.t('Preview')}
                    >
                        <span aria-hidden="true">{l10n.t('Preview')}</span>
                    </Badge>
                </Tooltip>
            </div>

            {/* Configuration Section */}
            <div className={styles.configSection}>
                <Text size={400} weight="semibold">
                    {l10n.t('Migration Configuration')}
                </Text>
                {isFirstVisit || descriptionExpanded ? (
                    <Text size={200}>
                        {l10n.t(
                            'Migrate your application from a relational database (RDBMS) to Azure Cosmos DB NoSQL with AI-assisted analysis. Follow the phases below to inventory your schema, analyze your application, and configure your target environment.',
                        )}
                    </Text>
                ) : (
                    <Text size={200} style={{ color: 'var(--vscode-descriptionForeground)' }}>
                        {l10n.t('RDBMS → Cosmos DB NoSQL migration assistant.')}{' '}
                        <Link
                            style={{ fontSize: '12px' }}
                            aria-description={l10n.t('Show full migration assistant description')}
                            onClick={() => setDescriptionExpanded(true)}
                        >
                            {l10n.t('More…')}
                        </Link>
                    </Text>
                )}

                <Field label={l10n.t('Workspace')}>
                    <Text size={200}>{state.workspacePath}</Text>
                </Field>

                <Field required label={l10n.t('Project Name')}>
                    <Input
                        value={state.projectName}
                        disabled={isRunActive}
                        onChange={(_e, data) => handleProjectNameChange(data.value)}
                        placeholder={l10n.t('Enter a project name')}
                    />
                </Field>

                {state.hasGitRepo === true && state.isInGitignore !== null && (
                    <Checkbox
                        data-testid="migration-gitignore-exclude"
                        disabled={isRunActive}
                        checked={state.isInGitignore === true}
                        onChange={(_e, data) => {
                            if (data.checked === true) {
                                handleAddToGitignore();
                            } else {
                                handleRemoveFromGitignore();
                            }
                        }}
                        label={
                            <>
                                {l10n.t('Exclude migration configuration from version control')}
                                <InfoTooltipIcon
                                    content={l10n.t(
                                        'Tracking migration progress in Git is recommended. Only exclude the .cosmosdb-migration folder if you prefer not to commit AI-generated migration artifacts to your repository.',
                                    )}
                                    ariaLabel={l10n.t('Exclude migration configuration help')}
                                    styles={styles}
                                />
                            </>
                        }
                    />
                )}

                {state.availableModels.length > 0 && (
                    <Field required label={l10n.t('AI Model')}>
                        <Dropdown
                            data-testid="migration-model-dropdown"
                            disabled={isRunActive}
                            onOptionSelect={handleModelChange}
                            value={selectedModel?.name ?? ''}
                            selectedOptions={state.selectedModelId ? [state.selectedModelId] : []}
                        >
                            {(() => {
                                const autoModel = state.availableModels.find(isAutoModel);
                                const { recommended, others } = partitionModelsByCapability(
                                    state.availableModels.filter((model) => !isAutoModel(model)),
                                );
                                const renderOption = (model: ModelInfo) => (
                                    <Option key={model.id} value={model.id} text={model.name}>
                                        {model.name}{' '}
                                        <span style={{ color: 'var(--vscode-descriptionForeground)' }}>
                                            {formatTokenCount(model.maxInputTokens)} tokens
                                        </span>
                                    </Option>
                                );
                                return (
                                    <>
                                        {autoModel && (
                                            <Option value={autoModel.id} text={autoModel.name}>
                                                {autoModel.name}
                                            </Option>
                                        )}
                                        {recommended.map(renderOption)}
                                        {others.length > 0 && (
                                            <OptionGroup label={l10n.t('Others')}>
                                                {others.map(renderOption)}
                                            </OptionGroup>
                                        )}
                                    </>
                                );
                            })()}
                        </Dropdown>
                    </Field>
                )}

                <Checkbox
                    data-testid="migration-consent-checkbox"
                    disabled={isRunActive}
                    checked={state.consentGiven}
                    onChange={handleConsentChange}
                    label={
                        <>
                            {l10n.t(
                                'I acknowledge that this feature uses AI and that my code, schema files, and other data will be processed by GitHub Copilot using the selected AI model to assist with the migration.',
                            )}{' '}
                            <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                        </>
                    }
                />

                {!state.isAIFeaturesEnabled && (
                    <Text data-testid="migration-ai-disabled-warning" className={styles.warningText}>
                        {l10n.t('AI features are currently unavailable. Please ensure GitHub Copilot is active.')}
                    </Text>
                )}
            </div>

            {/* Git warning */}
            {state.hasGitRepo === false && (
                <div className={styles.configSection}>
                    <Text className={styles.warningText}>
                        {l10n.t(
                            'This workspace is not under version control. It is strongly recommended to initialize a Git repository before starting the migration.',
                        )}
                    </Text>
                    <Button
                        data-testid="migration-git-init"
                        disabled={isRunActive}
                        appearance="secondary"
                        size="small"
                        onClick={handleInitGit}
                    >
                        {l10n.t('Initialize Git Repository')}
                    </Button>
                </div>
            )}

            {/* Application Details Section */}
            <div className={styles.configSection} data-testid="migration-phase-preflight">
                <Text size={400} weight="semibold">
                    {l10n.t('Application Details')}
                </Text>

                <Text size={200} style={{ color: 'var(--vscode-descriptionForeground)' }}>
                    {l10n.t(
                        'Provide your database schema files and optionally volumetric data and access pattern descriptions to improve analysis accuracy.',
                    )}
                </Text>

                <div className={styles.detailsColumns}>
                    {/* Source Files — compact grid */}
                    <div className={styles.filePickerGrid}>
                        {/* Schema Files */}
                        <Text weight="semibold" size={200}>
                            {l10n.t('Database Schema Files:')}{' '}
                            <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                            <InfoPopoverIcon
                                content={
                                    <>
                                        <p style={tooltipParagraphStyle}>
                                            {l10n.t(
                                                'Provide the source database schema as one or more DDL/structure files. Supported file types: .sql, .json, .xml, .csv, .log, .out.',
                                            )}
                                        </p>
                                        <p style={tooltipParagraphStyle}>
                                            {l10n.t(
                                                'Use "Select Files…" or "Select Folder…" to add them, or copy them manually into the ',
                                            )}
                                            <Link onClick={handleRevealSchemaFolder}>schema-ddl/</Link>
                                            {l10n.t(' folder inside .cosmosdb-migration.')}
                                        </p>
                                        <p style={tooltipParagraphLastStyle}>
                                            {l10n.t(
                                                "If you don't have a schema file at hand, use the AI button (sparkle icon) to reverse-engineer the schema from your workspace code: it scans entity definitions, ORM mappings, repositories, and raw SQL, then writes one consolidated .sql file per discovered domain into the schema-ddl/ folder.",
                                            )}
                                        </p>
                                    </>
                                }
                                ariaLabel={l10n.t('Database schema files help')}
                                styles={styles}
                            />
                        </Text>
                        <Button
                            appearance="secondary"
                            size="small"
                            aria-description={l10n.t('Database Schema Files, required')}
                            onClick={handleSelectSchemaFiles}
                            disabled={isRunActive}
                        >
                            {l10n.t('Select Files…')}
                        </Button>
                        <Button
                            appearance="secondary"
                            size="small"
                            aria-description={l10n.t('Database Schema Files, required')}
                            onClick={handleSelectSchemaFolder}
                            disabled={isRunActive}
                        >
                            {l10n.t('Select Folder…')}
                        </Button>
                        <MigrationActionButton
                            {...chatActionProps}
                            activity={actionActivity('preflight', 'schema-acquisition')}
                            compact
                            actionLabel={generateSchemaLabel}
                            appearance="primary"
                            size="small"
                            icon={<SparkleRegular />}
                            aria-label={generateSchemaLabel}
                            aria-description={`${l10n.t('Database Schema Files, required')}${aiActionDisabledDescription ? ` ${aiActionDisabledDescription}` : ''}`}
                            onClick={handleAnalyzeDatabaseSchema}
                            disabled={isAiActionDisabled}
                        />
                        <div className={styles.filePickerExpanderRow} data-testid="migration-step-schema-acquisition">
                            <FileListExpander
                                files={state.schemaFiles}
                                disabled={isRunActive}
                                excludedFiles={state.excludedSchemaFiles}
                                workspacePath={state.workspacePath}
                                onOpenFile={handleOpenFile}
                                onRemoveFile={handleRemoveSchemaFile}
                                onRestoreFile={handleRestoreSchemaFile}
                                styles={styles}
                            />
                        </div>

                        {/* Volumetric Files */}
                        <Text weight="semibold" size={200}>
                            {l10n.t('Volumetrics:')}
                            <InfoPopoverIcon
                                content={
                                    <>
                                        <p style={tooltipParagraphStyle}>
                                            {l10n.t(
                                                'Provide quantitative data about your database: row counts, table sizes, read/write ratios, hot collections, and query frequencies. Accepted file types: .txt, .csv, .json, .html, .xls (typical sources include query logs and AWR reports).',
                                            )}
                                        </p>
                                        <p style={tooltipParagraphStyle}>
                                            {l10n.t(
                                                'Use "Select Files…" or "Select Folder…" to add them, or copy them manually into the ',
                                            )}
                                            <Link onClick={handleRevealVolumetricsFolder}>volumetrics/</Link>
                                            {l10n.t(' folder inside .cosmosdb-migration.')}
                                        </p>
                                        <p style={tooltipParagraphLastStyle}>
                                            {l10n.t(
                                                'No raw data? Open the volumetrics template and fill it in by hand, or use the AI button (sparkle icon) to populate it from your workspace code and existing schema files.',
                                            )}
                                        </p>
                                    </>
                                }
                                ariaLabel={l10n.t('Volumetrics help')}
                                styles={styles}
                            />
                        </Text>
                        <Button
                            appearance="secondary"
                            size="small"
                            onClick={handleSelectVolumetricFiles}
                            disabled={isRunActive}
                        >
                            {l10n.t('Select Files…')}
                        </Button>
                        <Button
                            appearance="secondary"
                            size="small"
                            onClick={handleSelectVolumetricFolder}
                            disabled={isRunActive}
                        >
                            {l10n.t('Select Folder…')}
                        </Button>
                        <Button
                            appearance="secondary"
                            size="small"
                            onClick={handleOpenVolumetricsTemplate}
                            style={{ gridColumn: '2 / span 2' }}
                        >
                            {l10n.t('Open Volumetrics Template')}
                        </Button>
                        <MigrationActionButton
                            {...chatActionProps}
                            activity={actionActivity('preflight', 'volumetrics')}
                            compact
                            actionLabel={updateVolumetricsLabel}
                            appearance="primary"
                            size="small"
                            icon={<SparkleRegular />}
                            aria-label={updateVolumetricsLabel}
                            aria-description={aiActionDisabledDescription}
                            onClick={handleAnalyzeVolumetrics}
                            disabled={isAiActionDisabled}
                        />
                        <div className={styles.filePickerExpanderRow} data-testid="migration-step-volumetrics">
                            <FileListExpander
                                files={state.volumetricFiles}
                                disabled={isRunActive}
                                excludedFiles={state.excludedVolumetricFiles}
                                workspacePath={state.workspacePath}
                                onOpenFile={handleOpenFile}
                                onRemoveFile={handleRemoveVolumetricFile}
                                onRestoreFile={handleRestoreVolumetricFile}
                                protectedFileName="volumetrics.md"
                                styles={styles}
                            />
                        </div>

                        {/* Access Pattern Files */}
                        <Text weight="semibold" size={200}>
                            {l10n.t('Access Patterns:')}
                            <InfoPopoverIcon
                                content={
                                    <>
                                        <p style={tooltipParagraphStyle}>
                                            {l10n.t(
                                                'Describe how the application reads and writes data: top queries, joins, filters, sort orders, and any latency or throughput requirements. Accepted file type: .md (one or more Markdown files).',
                                            )}
                                        </p>
                                        <p style={tooltipParagraphStyle}>
                                            {l10n.t(
                                                'Use "Select Files…" or "Select Folder…" to add them, or copy them manually into the ',
                                            )}
                                            <Link onClick={handleRevealAccessPatternsFolder}>access-patterns/</Link>
                                            {l10n.t(' folder inside .cosmosdb-migration.')}
                                        </p>
                                        <p style={tooltipParagraphLastStyle}>
                                            {l10n.t(
                                                'Not sure where to start? Open the access-patterns template and fill it in by hand, or use the AI button (sparkle icon) to derive patterns from your workspace code — repositories, query builders, and raw SQL.',
                                            )}
                                        </p>
                                    </>
                                }
                                ariaLabel={l10n.t('Access patterns help')}
                                styles={styles}
                            />
                        </Text>
                        <Button
                            appearance="secondary"
                            size="small"
                            onClick={handleSelectAccessPatternFiles}
                            disabled={isRunActive}
                        >
                            {l10n.t('Select Files…')}
                        </Button>
                        <Button
                            appearance="secondary"
                            size="small"
                            onClick={handleSelectAccessPatternFolder}
                            disabled={isRunActive}
                        >
                            {l10n.t('Select Folder…')}
                        </Button>
                        <Button
                            appearance="secondary"
                            size="small"
                            onClick={handleOpenAccessPatternsTemplate}
                            style={{ gridColumn: '2 / span 2' }}
                        >
                            {l10n.t('Open Access-Patterns Template')}
                        </Button>
                        <MigrationActionButton
                            {...chatActionProps}
                            activity={actionActivity('preflight', 'access-patterns')}
                            compact
                            actionLabel={updateAccessPatternsLabel}
                            appearance="primary"
                            size="small"
                            icon={<SparkleRegular />}
                            aria-label={updateAccessPatternsLabel}
                            aria-description={aiActionDisabledDescription}
                            onClick={handleAnalyzeAccessPatterns}
                            disabled={isAiActionDisabled}
                        />
                        <div className={styles.filePickerExpanderRow} data-testid="migration-step-access-patterns">
                            <FileListExpander
                                files={state.accessPatternFiles}
                                disabled={isRunActive}
                                excludedFiles={state.excludedAccessPatternFiles}
                                workspacePath={state.workspacePath}
                                onOpenFile={handleOpenFile}
                                onRemoveFile={handleRemoveAccessPatternFile}
                                onRestoreFile={handleRestoreAccessPatternFile}
                                protectedFileName="access-patterns.md"
                                styles={styles}
                            />
                        </div>
                    </div>

                    {/* Analysis Fields */}
                    <div className={styles.analysisPanel}>
                        <div className={styles.analysisResult}>
                            <Text weight="semibold" size={200}>
                                <span id={`${analysisLabelId}-project`}>{l10n.t('Project:')}</span>{' '}
                                <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                                <InfoTooltipIcon
                                    content={l10n.t(
                                        'The name of your application or service. Examples: OrderService, InventoryAPI, CustomerPortal',
                                    )}
                                    ariaLabel={l10n.t('Project field help')}
                                    styles={styles}
                                />
                            </Text>
                            <Field
                                required
                                validationMessage={
                                    !state.analysisResult?.projectName?.trim() ? l10n.t('Required') : undefined
                                }
                                validationState={!state.analysisResult?.projectName?.trim() ? 'error' : 'none'}
                            >
                                <Input
                                    data-testid="migration-project-name"
                                    disabled={isRunActive}
                                    aria-labelledby={`${analysisLabelId}-project`}
                                    size="small"
                                    value={state.analysisResult?.projectName ?? ''}
                                    onChange={(_e, data) => handleAnalysisFieldChange('projectName', data.value)}
                                    placeholder={l10n.t('e.g. My Application')}
                                />
                            </Field>
                            <Text weight="semibold" size={200}>
                                <span id={`${analysisLabelId}-type`}>{l10n.t('Type:')}</span>{' '}
                                <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                                <InfoTooltipIcon
                                    content={l10n.t(
                                        'The architecture or deployment style of your application. Examples: Web API, Microservice, Monolithic MVC',
                                    )}
                                    ariaLabel={l10n.t('Type field help')}
                                    styles={styles}
                                />
                            </Text>
                            <Field
                                required
                                validationMessage={
                                    !state.analysisResult?.projectType?.trim() ? l10n.t('Required') : undefined
                                }
                                validationState={!state.analysisResult?.projectType?.trim() ? 'error' : 'none'}
                            >
                                <Input
                                    data-testid="migration-project-type"
                                    disabled={isRunActive}
                                    aria-labelledby={`${analysisLabelId}-type`}
                                    size="small"
                                    value={state.analysisResult?.projectType ?? ''}
                                    onChange={(_e, data) => handleAnalysisFieldChange('projectType', data.value)}
                                    placeholder={l10n.t('e.g. Web API, Microservice')}
                                />
                            </Field>
                            <Text weight="semibold" size={200}>
                                <span id={`${analysisLabelId}-language`}>{l10n.t('Language:')}</span>{' '}
                                <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                                <InfoTooltipIcon
                                    content={l10n.t(
                                        'The primary programming language of your application. Examples: C#, Java, Python',
                                    )}
                                    ariaLabel={l10n.t('Language field help')}
                                    styles={styles}
                                />
                            </Text>
                            <Field
                                required
                                validationMessage={
                                    !state.analysisResult?.language?.trim() ? l10n.t('Required') : undefined
                                }
                                validationState={!state.analysisResult?.language?.trim() ? 'error' : 'none'}
                            >
                                <Input
                                    data-testid="migration-language"
                                    disabled={isRunActive}
                                    aria-labelledby={`${analysisLabelId}-language`}
                                    size="small"
                                    value={state.analysisResult?.language ?? ''}
                                    onChange={(_e, data) => handleAnalysisFieldChange('language', data.value)}
                                    placeholder={l10n.t('e.g. C#, Java, Python')}
                                />
                            </Field>
                            <Text weight="semibold" size={200}>
                                <span id={`${analysisLabelId}-frameworks`}>{l10n.t('Frameworks:')}</span>{' '}
                                <InfoTooltipIcon
                                    content={l10n.t(
                                        'Optional data-access or web frameworks, such as Entity Framework Core, Spring Boot, Django, or Flask.',
                                    )}
                                    ariaLabel={l10n.t('Frameworks field help')}
                                    styles={styles}
                                />
                            </Text>
                            <Field>
                                <Input
                                    data-testid="migration-frameworks"
                                    disabled={isRunActive}
                                    aria-labelledby={`${analysisLabelId}-frameworks`}
                                    size="small"
                                    value={state.analysisResult?.frameworks?.join(', ') ?? ''}
                                    onChange={(_e, data) => handleFrameworksChange(data.value)}
                                    placeholder={l10n.t('e.g. Entity Framework Core, Spring Boot, Django')}
                                />
                            </Field>
                            <Text weight="semibold" size={200}>
                                <span id={`${analysisLabelId}-database`}>{l10n.t('Database:')}</span>{' '}
                                <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                                <InfoTooltipIcon
                                    content={l10n.t(
                                        'The source relational database system you are migrating from. Examples: PostgreSQL, SQL Server, Oracle',
                                    )}
                                    ariaLabel={l10n.t('Database field help')}
                                    styles={styles}
                                />
                            </Text>
                            <Field
                                required
                                validationMessage={
                                    !state.analysisResult?.databaseType?.trim() ? l10n.t('Required') : undefined
                                }
                                validationState={!state.analysisResult?.databaseType?.trim() ? 'error' : 'none'}
                            >
                                <Input
                                    data-testid="migration-database"
                                    disabled={isRunActive}
                                    aria-labelledby={`${analysisLabelId}-database`}
                                    size="small"
                                    value={state.analysisResult?.databaseType ?? ''}
                                    onChange={(_e, data) => handleAnalysisFieldChange('databaseType', data.value)}
                                    placeholder={l10n.t('e.g. PostgreSQL, SQL Server, Oracle')}
                                />
                            </Field>
                            <Text weight="semibold" size={200}>
                                <span id={`${analysisLabelId}-access`}>{l10n.t('Access Method:')}</span>{' '}
                                <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                                <InfoTooltipIcon
                                    content={l10n.t(
                                        'How your application connects to the database. Examples: Entity Framework, JDBC, Raw SQL queries',
                                    )}
                                    ariaLabel={l10n.t('Access method field help')}
                                    styles={styles}
                                />
                            </Text>
                            <Field
                                required
                                validationMessage={
                                    !state.analysisResult?.databaseAccess?.trim() ? l10n.t('Required') : undefined
                                }
                                validationState={!state.analysisResult?.databaseAccess?.trim() ? 'error' : 'none'}
                            >
                                <Input
                                    data-testid="migration-access"
                                    disabled={isRunActive}
                                    aria-labelledby={`${analysisLabelId}-access`}
                                    size="small"
                                    value={state.analysisResult?.databaseAccess ?? ''}
                                    onChange={(_e, data) => handleAnalysisFieldChange('databaseAccess', data.value)}
                                    placeholder={l10n.t('e.g. Entity Framework, JDBC')}
                                />
                            </Field>
                        </div>

                        {/* Auto-Detect Button */}
                        <div style={{ paddingTop: '8px' }} data-testid="migration-step-application-details">
                            {!state.consentGiven && (
                                <Text size={200} className={styles.warningText}>
                                    {l10n.t('Please check the AI consent checkbox above before using Auto-Detect.')}
                                </Text>
                            )}

                            {state.analysisState === 'in-progress' && (
                                <div className={styles.progressRow}>
                                    <ProgressBar style={{ flex: 1 }} />
                                    <Button appearance="secondary" size="small" onClick={handleCancelAnalysis}>
                                        {l10n.t('Cancel')}
                                    </Button>
                                </div>
                            )}

                            {state.analysisState !== 'in-progress' &&
                                (() => {
                                    const autoDetectDisabled = isAiActionDisabled;
                                    const autoDetectTooltip = !state.consentGiven
                                        ? l10n.t('AI consent is required to use Auto-Detect.')
                                        : !state.isAIFeaturesEnabled
                                          ? l10n.t('GitHub Copilot must be active to use Auto-Detect.')
                                          : '';
                                    const button = (
                                        <MigrationActionButton
                                            {...chatActionProps}
                                            activity={actionActivity('preflight', 'application-details')}
                                            compact
                                            actionLabel={l10n.t('Auto-Detect')}
                                            data-testid="migration-auto-detect"
                                            appearance="primary"
                                            size="small"
                                            icon={<SparkleRegular />}
                                            onClick={handleAnalyze}
                                            disabled={autoDetectDisabled}
                                            style={{ width: '100%' }}
                                        >
                                            {state.analysisState === 'complete'
                                                ? l10n.t('Re-Run Auto-Detect')
                                                : l10n.t('Auto-Detect')}
                                        </MigrationActionButton>
                                    );
                                    return autoDetectTooltip ? (
                                        <Tooltip content={autoDetectTooltip} relationship="description" withArrow>
                                            <span>{button}</span>
                                        </Tooltip>
                                    ) : (
                                        button
                                    );
                                })()}

                            {state.analysisError && (
                                <Text role="alert" className={styles.errorText}>
                                    <DismissCircleRegular /> {state.analysisError}
                                </Text>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Migration Phases */}
            <div className={styles.configSection}>
                <Accordion
                    collapsible
                    openItems={openPhases}
                    onToggle={(_event, data) => setOpenPhases(data.openItems as string[])}
                >
                    {/* Phase 1: Source Discovery */}
                    <AccordionItem value="phase1" data-testid="migration-phase-discovery">
                        <AccordionHeader icon={getPhaseIcon(phase1State)}>
                            <Text weight="semibold">{l10n.t('Phase 1: Source Discovery')}</Text>
                            {phase1State === 'complete' && (
                                <Badge
                                    data-testid="migration-phase1-status-complete"
                                    appearance="filled"
                                    color="success"
                                    style={{ marginLeft: '8px' }}
                                >
                                    {l10n.t('Complete')}
                                </Badge>
                            )}
                        </AccordionHeader>
                        <AccordionPanel>
                            <div className={styles.stepContent}>
                                <Text size={200}>
                                    {l10n.t(
                                        'Generate a comprehensive discovery report using AI analysis of your schema, access patterns, and application details.',
                                    )}
                                </Text>

                                <Field
                                    label={
                                        <>
                                            {l10n.t('Additional Discovery Instructions')}
                                            <InfoTooltipIcon
                                                content={l10n.t(
                                                    'Provide additional context or specific focus areas for the discovery report. These instructions will be included in the AI prompt when generating the report.',
                                                )}
                                                ariaLabel={l10n.t('Additional discovery instructions help')}
                                                styles={styles}
                                            />
                                        </>
                                    }
                                >
                                    <Textarea
                                        data-testid="migration-discovery-instructions"
                                        disabled={isRunActive}
                                        value={state.discoveryInstructions ?? ''}
                                        onChange={handleDiscoveryInstructionsChange}
                                        placeholder={l10n.t(
                                            'e.g., Focus on the ordering domain, ignore legacy tables prefixed with tmp_…',
                                        )}
                                        resize="vertical"
                                        rows={3}
                                    />
                                </Field>

                                {state.discoveryState === 'in-progress' && (
                                    <div className={styles.progressRow}>
                                        <ProgressBar style={{ flex: 1 }} />
                                        <Button appearance="secondary" size="small" onClick={handleCancelDiscovery}>
                                            {l10n.t('Cancel')}
                                        </Button>
                                    </div>
                                )}

                                {state.discoveryState !== 'in-progress' &&
                                    (state.useProgrammaticFlow && state.showTokenEstimate ? (
                                        <div className={styles.buttonRow}>
                                            <MigrationActionButton
                                                {...chatActionProps}
                                                activity={actionActivity('discovery')}
                                                actionLabel={l10n.t('Generate Discovery Report')}
                                                data-testid="migration-run-discovery"
                                                appearance="primary"
                                                size="small"
                                                icon={<SparkleRegular />}
                                                onClick={handleRunDiscovery}
                                                disabled={isDiscoveryDisabled}
                                            >
                                                {state.discoveryState === 'complete'
                                                    ? l10n.t('Re-Generate Report')
                                                    : l10n.t('Generate Discovery Report')}
                                            </MigrationActionButton>
                                            {isAutoSelected ? (
                                                <output>
                                                    <Text size={200}>
                                                        {l10n.t('Token estimate unavailable for Auto.')}
                                                    </Text>
                                                </output>
                                            ) : (
                                                <TokenBudgetBar
                                                    estimate={state.tokenEstimate}
                                                    isEstimating={isEstimating}
                                                />
                                            )}
                                        </div>
                                    ) : (
                                        <MigrationActionButton
                                            {...chatActionProps}
                                            activity={actionActivity('discovery')}
                                            actionLabel={l10n.t('Generate Discovery Report')}
                                            data-testid="migration-run-discovery"
                                            appearance="primary"
                                            size="small"
                                            icon={<SparkleRegular />}
                                            onClick={handleRunDiscovery}
                                            disabled={isDiscoveryDisabled}
                                        >
                                            {state.discoveryState === 'complete'
                                                ? l10n.t('Re-Generate Report')
                                                : l10n.t('Generate Discovery Report')}
                                        </MigrationActionButton>
                                    ))}

                                {state.discoveryError && (
                                    <Text role="alert" className={styles.errorText}>
                                        <DismissCircleRegular /> {state.discoveryError}
                                    </Text>
                                )}

                                {phase1State === 'complete' && (
                                    <Button
                                        data-testid="migration-view-discovery"
                                        appearance="secondary"
                                        size="small"
                                        icon={<DocumentRegular />}
                                        onClick={() =>
                                            handlePreviewMarkdown(
                                                `${state.workspacePath}/.cosmosdb-migration/phases/1-discovery/discovery-report.md`,
                                            )
                                        }
                                    >
                                        {l10n.t('View Discovery Report')}
                                    </Button>
                                )}
                            </div>
                        </AccordionPanel>
                    </AccordionItem>

                    <div className={styles.phaseDivider} />

                    {/* Phase 2: Domain Assessment */}
                    <AccordionItem value="phase2" data-testid="migration-phase-assessment">
                        <AccordionHeader
                            icon={getPhaseIcon(
                                phase2State === 'complete' ? 'complete' : isPhase2Disabled ? 'locked' : phase2State,
                            )}
                        >
                            <Text weight="semibold">{l10n.t('Phase 2: Domain Assessment')}</Text>
                            {phase2State === 'complete' && (
                                <Badge
                                    data-testid="migration-phase2-status-complete"
                                    appearance="filled"
                                    color="success"
                                    style={{ marginLeft: '8px' }}
                                >
                                    {l10n.t('Complete')}
                                </Badge>
                            )}
                        </AccordionHeader>
                        <AccordionPanel>
                            <div className={styles.stepContent}>
                                <div
                                    className={`${styles.phaseInputs} ${phase2State === 'complete' ? styles.completedContent : ''}`}
                                >
                                    <Text size={200}>
                                        {l10n.t(
                                            'Run AI-powered domain decomposition to identify bounded contexts, group related tables, and generate Cosmos DB migration recommendations.',
                                        )}
                                    </Text>

                                    {state.assessmentState === 'in-progress' && (
                                        <>
                                            <div className={styles.progressRow}>
                                                <ProgressBar style={{ flex: 1 }} />
                                                <Button
                                                    appearance="secondary"
                                                    size="small"
                                                    onClick={handleCancelAssessment}
                                                >
                                                    {l10n.t('Cancel')}
                                                </Button>
                                            </div>
                                            {state.assessmentProgress && (
                                                <output aria-live="polite">
                                                    <Text
                                                        size={200}
                                                        style={{ color: 'var(--vscode-descriptionForeground)' }}
                                                    >
                                                        {state.assessmentProgress}
                                                    </Text>
                                                </output>
                                            )}
                                        </>
                                    )}

                                    {state.assessmentState !== 'in-progress' && (
                                        <>
                                            <Field
                                                label={
                                                    <>
                                                        {l10n.t('Additional Assessment Instructions')}
                                                        <InfoTooltipIcon
                                                            content={l10n.t(
                                                                'Provide additional context or specific focus areas for domain assessment. These instructions will be included in the AI prompt when running assessment.',
                                                            )}
                                                            ariaLabel={l10n.t(
                                                                'Additional assessment instructions help',
                                                            )}
                                                            styles={styles}
                                                        />
                                                    </>
                                                }
                                            >
                                                <Textarea
                                                    data-testid="migration-assessment-instructions"
                                                    disabled={isRunActive}
                                                    value={state.assessmentInstructions ?? ''}
                                                    onChange={handleAssessmentInstructionsChange}
                                                    placeholder={l10n.t(
                                                        'e.g., Prioritize minimizing cross-domain joins and keep payment-related tables isolated…',
                                                    )}
                                                    resize="vertical"
                                                    rows={3}
                                                />
                                            </Field>

                                            <MigrationActionButton
                                                {...chatActionProps}
                                                activity={actionActivity('assessment')}
                                                actionLabel={l10n.t('Run Assessment')}
                                                data-testid="migration-run-assessment"
                                                appearance="primary"
                                                size="small"
                                                icon={<SparkleRegular />}
                                                onClick={handleRunAssessment}
                                                disabled={
                                                    isPhase2Disabled ||
                                                    !state.consentGiven ||
                                                    !state.isAIFeaturesEnabled
                                                }
                                            >
                                                {state.assessmentState === 'complete'
                                                    ? l10n.t('Re-Run Assessment')
                                                    : l10n.t('Run Assessment')}
                                            </MigrationActionButton>
                                        </>
                                    )}
                                </div>

                                {state.assessmentError && (
                                    <Text role="alert" className={styles.errorText}>
                                        <DismissCircleRegular /> {state.assessmentError}
                                    </Text>
                                )}

                                {state.assessmentResult && (
                                    <div className={styles.stepContent}>
                                        <Text weight="semibold">
                                            {l10n.t('{count} domain(s) identified', {
                                                count: state.assessmentResult.domainFiles.length,
                                            })}
                                        </Text>
                                        <table
                                            data-testid="migration-phase2-domains"
                                            style={{
                                                width: '100%',
                                                borderCollapse: 'collapse',
                                                fontSize: '12px',
                                            }}
                                        >
                                            <thead>
                                                <tr
                                                    style={{
                                                        borderBottom: '1px solid var(--vscode-panel-border)',
                                                        textAlign: 'left',
                                                    }}
                                                >
                                                    <th style={{ padding: '4px 6px' }}>{l10n.t('Domain')}</th>
                                                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>
                                                        {l10n.t('Tables')}
                                                    </th>
                                                    {state.useProgrammaticFlow && (
                                                        <th style={{ padding: '4px 6px', textAlign: 'right' }}>
                                                            {l10n.t('Est. Tokens')}
                                                        </th>
                                                    )}
                                                    <th style={{ padding: '4px 6px', textAlign: 'center' }}>
                                                        {l10n.t('Referenced in Code')}
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {state.assessmentResult.domainFiles.map((domain, i) => (
                                                    <tr
                                                        key={i}
                                                        style={{
                                                            borderBottom: '1px solid var(--vscode-panel-border)',
                                                        }}
                                                    >
                                                        <td style={{ padding: '4px 6px' }}>
                                                            <Link
                                                                data-testid="migration-phase2-domain-link"
                                                                className={styles.fileLink}
                                                                onClick={() => handlePreviewMarkdown(domain.filePath)}
                                                            >
                                                                {domain.name}
                                                            </Link>
                                                        </td>
                                                        <td
                                                            style={{
                                                                padding: '4px 6px',
                                                                textAlign: 'right',
                                                                color: 'var(--vscode-descriptionForeground)',
                                                            }}
                                                        >
                                                            {domain.tables.length}
                                                        </td>
                                                        {state.useProgrammaticFlow && (
                                                            <td
                                                                style={{
                                                                    padding: '4px 6px',
                                                                    textAlign: 'right',
                                                                    color: 'var(--vscode-descriptionForeground)',
                                                                }}
                                                            >
                                                                {formatTokenCount(domain.estimatedTokens)}
                                                            </td>
                                                        )}
                                                        <td
                                                            style={{
                                                                padding: '4px 6px',
                                                                textAlign: 'center',
                                                            }}
                                                        >
                                                            <ReferencedInCodeStatus isMapped={domain.isMapped} />
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        <Button
                                            data-testid="migration-phase2-summary"
                                            appearance="secondary"
                                            size="small"
                                            icon={<DocumentRegular />}
                                            onClick={() =>
                                                handlePreviewMarkdown(state.assessmentResult!.summaryFilePath)
                                            }
                                        >
                                            {l10n.t('View full assessment summary')}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </AccordionPanel>
                    </AccordionItem>

                    <div className={styles.phaseDivider} />

                    {/* Phase 3: Schema Conversion */}
                    <AccordionItem value="phase3" data-testid="migration-phase-schema-conversion">
                        <AccordionHeader
                            icon={getPhaseIcon(
                                phase3State === 'complete' ? 'complete' : isPhase3Disabled ? 'locked' : phase3State,
                            )}
                        >
                            <Text weight="semibold">{l10n.t('Phase 3: Schema Conversion')}</Text>
                            {phase3State === 'complete' && (
                                <Badge
                                    data-testid="migration-phase3-status-complete"
                                    appearance="filled"
                                    color="success"
                                    style={{ marginLeft: '8px' }}
                                >
                                    {l10n.t('Complete')}
                                </Badge>
                            )}
                        </AccordionHeader>
                        <AccordionPanel>
                            <div className={styles.stepContent}>
                                <div
                                    className={`${styles.phaseInputs} ${phase3State === 'complete' ? styles.completedContent : ''}`}
                                >
                                    <Text size={200}>
                                        {l10n.t(
                                            'Transform your RDBMS schema into optimized Cosmos DB NoSQL data models. This phase designs containers, partition keys, embedding strategies, access patterns, and indexing policies for each domain.',
                                        )}
                                    </Text>

                                    <Checkbox
                                        checked={state.includeUnmappedDomains}
                                        onChange={handleIncludeUnmappedDomainsChange}
                                        disabled={isRunActive || state.schemaConversionState === 'in-progress'}
                                        label={l10n.t(
                                            'Include domains without detected application code access patterns (e.g. tables only referenced via stored procedures, ETL, or external systems)',
                                        )}
                                    />

                                    {state.useProgrammaticFlow && (
                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                            <Checkbox
                                                checked={state.thoroughAnalysis}
                                                onChange={handleThoroughAnalysisChange}
                                                disabled={isRunActive || state.schemaConversionState === 'in-progress'}
                                                label={l10n.t('Enable thorough analysis')}
                                            />
                                            <InfoTooltipIcon
                                                content={
                                                    l10n.t(
                                                        'Fast mode (default): Performs a single AI analysis pass per domain, producing a complete data model with containers, partition keys, embedding strategies, access pattern mappings, cross-partition analysis, and indexing policies in one step. Suitable for most migrations and significantly faster.',
                                                    ) +
                                                    '\n\n' +
                                                    l10n.t(
                                                        'Thorough mode: Runs 7 sequential analysis steps per domain, each focusing on a specific concern (container design, partition key selection, embedding decisions, access patterns, cross-partition queries, indexing, and summary). Produces detailed per-step output files for deeper review. Recommended for complex schemas or when you need granular analysis artifacts.',
                                                    )
                                                }
                                                ariaLabel={l10n.t('Thorough analysis mode help')}
                                                styles={styles}
                                            />
                                        </div>
                                    )}

                                    {state.schemaConversionState !== 'in-progress' && (
                                        <Field
                                            label={
                                                <>
                                                    {l10n.t('Additional Schema Conversion Instructions')}
                                                    <InfoTooltipIcon
                                                        content={l10n.t(
                                                            'Provide additional context or specific guidance for schema conversion. These instructions will be included in the AI prompt when designing containers, partition keys, embedding strategies, and other Cosmos DB schema decisions.',
                                                        )}
                                                        ariaLabel={l10n.t(
                                                            'Additional schema conversion instructions help',
                                                        )}
                                                        styles={styles}
                                                    />
                                                </>
                                            }
                                        >
                                            <Textarea
                                                data-testid="migration-conversion-instructions"
                                                disabled={isRunActive}
                                                value={state.schemaConversionInstructions ?? ''}
                                                onChange={handleSchemaConversionInstructionsChange}
                                                placeholder={l10n.t(
                                                    'e.g., Use serverless throughput mode, prefer embedding over referencing for 1:few relationships, keep all lookup tables in a single container…',
                                                )}
                                                resize="vertical"
                                                rows={3}
                                            />
                                        </Field>
                                    )}

                                    {state.schemaConversionState === 'in-progress' && (
                                        <>
                                            <div className={styles.progressRow}>
                                                <ProgressBar style={{ flex: 1 }} />
                                                <Button
                                                    appearance="secondary"
                                                    size="small"
                                                    onClick={handleCancelSchemaConversion}
                                                >
                                                    {l10n.t('Cancel')}
                                                </Button>
                                            </div>
                                            {state.schemaConversionProgress && (
                                                <output aria-live="polite">
                                                    <Text
                                                        size={200}
                                                        style={{ color: 'var(--vscode-descriptionForeground)' }}
                                                    >
                                                        {state.schemaConversionProgress}
                                                    </Text>
                                                </output>
                                            )}
                                        </>
                                    )}

                                    {state.schemaConversionState !== 'in-progress' && (
                                        <MigrationActionButton
                                            {...chatActionProps}
                                            activity={actionActivity('schema-conversion')}
                                            actionLabel={l10n.t('Run Schema Conversion')}
                                            data-testid="migration-run-conversion"
                                            appearance="primary"
                                            size="small"
                                            icon={<SparkleRegular />}
                                            onClick={handleRunSchemaConversion}
                                            disabled={
                                                isPhase3Disabled || !state.consentGiven || !state.isAIFeaturesEnabled
                                            }
                                        >
                                            {state.schemaConversionState === 'complete'
                                                ? l10n.t('Re-Run Schema Conversion')
                                                : l10n.t('Run Schema Conversion')}
                                        </MigrationActionButton>
                                    )}
                                </div>

                                {state.schemaConversionError && (
                                    <Text role="alert" className={styles.errorText}>
                                        <DismissCircleRegular /> {state.schemaConversionError}
                                    </Text>
                                )}

                                {state.schemaConversionResult && (
                                    <div className={styles.stepContent}>
                                        <Text weight="semibold">
                                            {l10n.t('{count} domain(s) converted', {
                                                count: state.schemaConversionResult.domains.length,
                                            })}
                                        </Text>
                                        <table
                                            data-testid="migration-phase3-domains"
                                            style={{
                                                width: '100%',
                                                borderCollapse: 'collapse',
                                                fontSize: '12px',
                                            }}
                                        >
                                            <thead>
                                                <tr
                                                    style={{
                                                        borderBottom: '1px solid var(--vscode-panel-border)',
                                                        textAlign: 'left',
                                                    }}
                                                >
                                                    <th style={{ padding: '4px 6px' }}>{l10n.t('Domain')}</th>
                                                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>
                                                        {l10n.t('Containers')}
                                                    </th>
                                                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>
                                                        {l10n.t('Entities')}
                                                    </th>
                                                    <th style={{ padding: '4px 6px', textAlign: 'center' }}>
                                                        {l10n.t('Model')}
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {state.schemaConversionResult.domains.map((domain, i) => (
                                                    <tr
                                                        key={i}
                                                        style={{
                                                            borderBottom: '1px solid var(--vscode-panel-border)',
                                                        }}
                                                    >
                                                        <td style={{ padding: '4px 6px' }}>
                                                            <Link
                                                                data-testid="migration-phase3-domain-link"
                                                                className={styles.fileLink}
                                                                onClick={() =>
                                                                    handlePreviewMarkdown(domain.summaryFilePath)
                                                                }
                                                            >
                                                                {domain.name}
                                                            </Link>
                                                        </td>
                                                        <td
                                                            style={{
                                                                padding: '4px 6px',
                                                                textAlign: 'right',
                                                                color: 'var(--vscode-descriptionForeground)',
                                                            }}
                                                        >
                                                            {domain.containers}
                                                        </td>
                                                        <td
                                                            style={{
                                                                padding: '4px 6px',
                                                                textAlign: 'right',
                                                                color: 'var(--vscode-descriptionForeground)',
                                                            }}
                                                        >
                                                            {domain.entities}
                                                        </td>
                                                        <td
                                                            style={{
                                                                padding: '4px 6px',
                                                                textAlign: 'center',
                                                            }}
                                                        >
                                                            <Link
                                                                data-testid="migration-phase3-model-link"
                                                                className={styles.fileLink}
                                                                style={{
                                                                    display: 'inline',
                                                                    paddingLeft: 0,
                                                                }}
                                                                onClick={() => handleOpenFile(domain.modelFilePath)}
                                                            >
                                                                {l10n.t('JSON')}
                                                            </Link>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        <div
                                            style={{
                                                display: 'flex',
                                                gap: '8px',
                                                flexWrap: 'wrap',
                                            }}
                                        >
                                            <Button
                                                data-testid="migration-phase3-summary"
                                                appearance="secondary"
                                                size="small"
                                                icon={<DocumentRegular />}
                                                onClick={() =>
                                                    handlePreviewMarkdown(state.schemaConversionResult!.summaryFilePath)
                                                }
                                            >
                                                {l10n.t('View Schema Conversion Summary')}
                                            </Button>
                                            <Button
                                                data-testid="migration-phase3-model"
                                                appearance="secondary"
                                                size="small"
                                                icon={<DocumentRegular />}
                                                onClick={() =>
                                                    handleOpenFile(state.schemaConversionResult!.mergedModelFilePath)
                                                }
                                            >
                                                {l10n.t('View Cosmos DB Model')}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </AccordionPanel>
                    </AccordionItem>

                    <div className={styles.phaseDivider} />

                    {/* Phase 4: Target Provisioning */}
                    <AccordionItem value="phase4" data-testid="migration-phase-provisioning">
                        <AccordionHeader
                            icon={getPhaseIcon(
                                phase4State === 'complete' ? 'complete' : isPhase4Disabled ? 'locked' : phase4State,
                            )}
                        >
                            <Text weight="semibold">{l10n.t('Phase 4: Target Provisioning')}</Text>
                            {phase4State === 'complete' && (
                                <Badge
                                    data-testid="migration-phase4-status-complete"
                                    appearance="filled"
                                    color="success"
                                    style={{ marginLeft: '8px' }}
                                >
                                    {l10n.t('Complete')}
                                </Badge>
                            )}
                        </AccordionHeader>
                        <AccordionPanel>
                            <div className={styles.stepContent}>
                                <div
                                    className={`${styles.phaseInputs} ${phase4State === 'complete' ? styles.completedContent : ''}`}
                                >
                                    <Text size={200}>
                                        {l10n.t('Select your target Cosmos DB environment and verify the connection.')}
                                    </Text>

                                    <Field required label={l10n.t('Target Environment')}>
                                        <RadioGroup
                                            value={state.targetType ?? ''}
                                            onChange={handleTargetTypeChange}
                                            disabled={isPhase4Disabled}
                                        >
                                            <Radio
                                                data-testid="migration-target-emulator"
                                                value="emulator"
                                                label={l10n.t('Local Cosmos DB Emulator')}
                                            />
                                            <Radio value="azure" label={l10n.t('Azure Cosmos DB Account')} />
                                            <Radio
                                                value="provision"
                                                label={l10n.t('Provision new Azure Cosmos DB Account')}
                                            />
                                        </RadioGroup>
                                    </Field>

                                    {state.targetType === 'azure' && (
                                        <Field
                                            label={
                                                <>
                                                    {l10n.t('Account Endpoint')}{' '}
                                                    <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                                                </>
                                            }
                                        >
                                            <div className={styles.buttonRow}>
                                                <Input
                                                    size="small"
                                                    style={{ flex: 1 }}
                                                    value={state.targetEndpoint}
                                                    onChange={(_e, data) => handleEndpointChange(data.value)}
                                                    placeholder={l10n.t(
                                                        'https://your-account.documents.azure.com:443/',
                                                    )}
                                                    disabled={isPhase4Disabled}
                                                />
                                                <Button
                                                    appearance="secondary"
                                                    size="small"
                                                    icon={<CosmosDBIcon />}
                                                    onClick={handleSelectAccount}
                                                    disabled={isPhase4Disabled}
                                                >
                                                    {l10n.t('Select Account')}
                                                </Button>
                                            </div>
                                        </Field>
                                    )}

                                    {state.targetType === 'provision' && (
                                        <>
                                            <Field
                                                label={
                                                    <>
                                                        {l10n.t('Resource Group')}{' '}
                                                        <span style={{ color: 'var(--vscode-errorForeground)' }}>
                                                            *
                                                        </span>
                                                    </>
                                                }
                                            >
                                                <div className={styles.buttonRow}>
                                                    <Input
                                                        size="small"
                                                        style={{ flex: 1 }}
                                                        value={state.targetResourceGroup}
                                                        readOnly
                                                        placeholder={l10n.t(
                                                            'Use the button to select or create a resource group',
                                                        )}
                                                        disabled={isPhase4Disabled}
                                                    />
                                                    <Button
                                                        appearance="secondary"
                                                        size="small"
                                                        icon={<DatabaseRegular />}
                                                        onClick={handleSelectResourceGroup}
                                                        disabled={isPhase4Disabled}
                                                    >
                                                        {l10n.t('Select Resource Group')}
                                                    </Button>
                                                </div>
                                            </Field>
                                            {state.targetSubscriptionName && (
                                                <Label size="small">
                                                    {l10n.t('Subscription: {0}', state.targetSubscriptionName)}
                                                </Label>
                                            )}
                                            <Field
                                                label={
                                                    <>
                                                        {l10n.t('Account Name')}{' '}
                                                        <span style={{ color: 'var(--vscode-errorForeground)' }}>
                                                            *
                                                        </span>
                                                    </>
                                                }
                                                validationState={accountNameValidationError ? 'error' : 'none'}
                                                validationMessage={accountNameValidationError}
                                            >
                                                <Input
                                                    size="small"
                                                    value={state.targetAccountName ?? ''}
                                                    onChange={(_e, data) => handleAccountNameChange(data.value)}
                                                    placeholder={l10n.t('my-cosmosdb-account')}
                                                    disabled={isPhase4Disabled}
                                                />
                                            </Field>
                                            <Field label={l10n.t('Location')}>
                                                {state.availableLocations.length > 0 ? (
                                                    <Dropdown
                                                        size="small"
                                                        value={
                                                            state.availableLocations.find(
                                                                (loc) => loc.name === state.targetLocation,
                                                            )?.displayName ?? state.targetLocation
                                                        }
                                                        selectedOptions={[state.targetLocation]}
                                                        onOptionSelect={handleLocationChange}
                                                        disabled={isPhase4Disabled}
                                                    >
                                                        {state.availableLocations.map((loc) => (
                                                            <Option key={loc.name} value={loc.name}>
                                                                {loc.displayName}
                                                            </Option>
                                                        ))}
                                                    </Dropdown>
                                                ) : (
                                                    <Input
                                                        size="small"
                                                        value={state.targetLocation}
                                                        readOnly
                                                        placeholder={l10n.t(
                                                            'Determined by the selected resource group',
                                                        )}
                                                        disabled={isPhase4Disabled}
                                                    />
                                                )}
                                            </Field>
                                            {state.bicepGenerated && (
                                                <Text size={200}>
                                                    {l10n.t(
                                                        'Prefer to provision manually? A Bicep template has been generated based on your schema.',
                                                    )}{' '}
                                                    <Link onClick={handleOpenGeneratedBicep}>
                                                        {l10n.t('Open generated Bicep template')}
                                                    </Link>
                                                </Text>
                                            )}
                                        </>
                                    )}

                                    {(state.targetType === 'provision' ||
                                        isMigrationRunActive(actionActivity('provisioning', 'target-account'))) && (
                                        <>
                                            {state.accountProvisioningState === 'in-progress' ? (
                                                <>
                                                    <div className={styles.progressRow}>
                                                        <ProgressBar style={{ flex: 1 }} />
                                                        <Button
                                                            appearance="secondary"
                                                            size="small"
                                                            icon={<StopRegular />}
                                                            onClick={handleCancelAccountProvisioning}
                                                        >
                                                            {l10n.t('Cancel')}
                                                        </Button>
                                                    </div>
                                                    {state.accountProvisioningProgress && (
                                                        <output aria-live="polite">
                                                            <Text size={200}>{state.accountProvisioningProgress}</Text>
                                                        </output>
                                                    )}
                                                </>
                                            ) : (
                                                <MigrationActionButton
                                                    {...chatActionProps}
                                                    activity={actionActivity('provisioning', 'target-account')}
                                                    actionLabel={l10n.t('Provision New Account')}
                                                    appearance="primary"
                                                    size="small"
                                                    icon={<CloudAddRegular />}
                                                    onClick={handleProvisionAccount}
                                                    disabled={
                                                        isPhase4Disabled ||
                                                        !state.targetResourceGroup ||
                                                        !state.targetAccountName ||
                                                        !state.targetLocation ||
                                                        !!accountNameValidationError
                                                    }
                                                >
                                                    {state.accountProvisioningState === 'complete'
                                                        ? l10n.t('Re-Provision Account')
                                                        : l10n.t('Provision New Account')}
                                                </MigrationActionButton>
                                            )}
                                            {state.accountProvisioningState === 'complete' && (
                                                <Text>
                                                    <CheckmarkCircleFilled
                                                        style={{ color: 'var(--vscode-testing-iconPassed)' }}
                                                    />{' '}
                                                    {l10n.t('Account provisioned successfully.')}
                                                </Text>
                                            )}
                                            {state.accountProvisioningError && (
                                                <Text role="alert" className={styles.errorText}>
                                                    <DismissCircleRegular /> {state.accountProvisioningError}
                                                </Text>
                                            )}
                                        </>
                                    )}

                                    {state.targetType &&
                                        (state.targetType !== 'provision' ||
                                            state.accountProvisioningState === 'complete') && (
                                            <>
                                                {state.connectionTestState === 'in-progress' ? (
                                                    <ProgressBar />
                                                ) : state.targetType === 'provision' ? null : (
                                                    <Button
                                                        data-testid="migration-test-connection"
                                                        appearance="primary"
                                                        size="small"
                                                        icon={<PlugConnectedRegular />}
                                                        onClick={handleTestConnection}
                                                        disabled={
                                                            isPhase4Disabled ||
                                                            !state.targetType ||
                                                            (state.targetType === 'azure' && !state.targetEndpoint)
                                                        }
                                                    >
                                                        {l10n.t('Test Connection')}
                                                    </Button>
                                                )}
                                            </>
                                        )}
                                </div>

                                {state.connectionVerified && (
                                    <Text data-testid="migration-connection-verified">
                                        <CheckmarkCircleFilled style={{ color: 'var(--vscode-testing-iconPassed)' }} />{' '}
                                        {l10n.t('Connection verified successfully.')}
                                    </Text>
                                )}

                                {state.connectionTestError && (
                                    <Text role="alert" className={styles.errorText}>
                                        <DismissCircleRegular /> {state.connectionTestError}
                                        {state.connectionTestDocumentationUrl && (
                                            <>
                                                {' '}
                                                <Link
                                                    href={state.connectionTestDocumentationUrl}
                                                    target="_blank"
                                                    inline
                                                >
                                                    {l10n.t('View installation instructions')}
                                                </Link>
                                            </>
                                        )}
                                    </Text>
                                )}

                                {/* Provisioning Section */}
                                {((state.connectionVerified && state.schemaConversionState === 'complete') ||
                                    isMigrationRunActive(actionActivity('provisioning', 'resources-and-data'))) && (
                                    <>
                                        <div className={styles.sectionDivider}>
                                            <Text weight="semibold" size={300}>
                                                {l10n.t('Populate Sample Data')}
                                            </Text>
                                            <Text size={200} style={{ display: 'block', marginTop: '4px' }}>
                                                {l10n.t(
                                                    'Create database, containers, and insert AI-generated sample data based on your converted schema.',
                                                )}
                                            </Text>
                                        </div>

                                        {state.provisioningState === 'in-progress' && (
                                            <>
                                                <div className={styles.progressRow}>
                                                    <ProgressBar style={{ flex: 1 }} />
                                                    <Button
                                                        appearance="secondary"
                                                        size="small"
                                                        icon={<StopRegular />}
                                                        onClick={handleCancelProvisioning}
                                                    >
                                                        {l10n.t('Cancel')}
                                                    </Button>
                                                </div>
                                                {state.provisioningProgress && (
                                                    <output aria-live="polite">
                                                        <Text size={200}>{state.provisioningProgress}</Text>
                                                    </output>
                                                )}
                                            </>
                                        )}

                                        {state.provisioningState !== 'in-progress' && (
                                            <MigrationActionButton
                                                {...chatActionProps}
                                                activity={actionActivity('provisioning', 'resources-and-data')}
                                                actionLabel={l10n.t('Populate Sample Data')}
                                                data-testid="migration-populate-sample-data"
                                                appearance="primary"
                                                size="small"
                                                icon={<DatabaseRegular />}
                                                onClick={handlePopulateSampleData}
                                                disabled={
                                                    isPhase4Disabled ||
                                                    !state.consentGiven ||
                                                    !state.isAIFeaturesEnabled
                                                }
                                            >
                                                {state.provisioningState === 'complete'
                                                    ? l10n.t('Re-Populate Sample Data')
                                                    : l10n.t('Populate Sample Data')}
                                            </MigrationActionButton>
                                        )}

                                        {state.provisioningError && (
                                            <Text role="alert" className={styles.errorText}>
                                                <DismissCircleRegular /> {state.provisioningError}
                                            </Text>
                                        )}

                                        {state.provisioningResult && (
                                            <div
                                                data-testid="migration-provisioning-summary"
                                                style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
                                            >
                                                <Text>
                                                    <CheckmarkCircleFilled
                                                        style={{ color: 'var(--vscode-testing-iconPassed)' }}
                                                    />{' '}
                                                    {l10n.t(
                                                        'Database "{0}" created with {1} container(s).',
                                                        state.provisioningResult.databaseName,
                                                        state.provisioningResult.containersCreated.length,
                                                    )}
                                                </Text>
                                                <Text size={200}>
                                                    {l10n.t(
                                                        'Containers: {0}',
                                                        state.provisioningResult.containersCreated.join(', '),
                                                    )}
                                                </Text>
                                                {state.provisioningResult.seedScriptPath && (
                                                    <Link
                                                        onClick={() =>
                                                            handleOpenFile(state.provisioningResult!.seedScriptPath)
                                                        }
                                                    >
                                                        {l10n.t('Open seed-data.csh script')}
                                                    </Link>
                                                )}
                                                {state.provisioningResult.warnings.length > 0 && (
                                                    <output
                                                        aria-live="polite"
                                                        style={{
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: '2px',
                                                            marginTop: '4px',
                                                        }}
                                                    >
                                                        <Text size={200} weight="semibold">
                                                            <WarningRegular
                                                                style={{
                                                                    color: 'var(--vscode-editorWarning-foreground)',
                                                                }}
                                                            />{' '}
                                                            {l10n.t(
                                                                'Some sample items were not inserted successfully:',
                                                            )}
                                                        </Text>
                                                        {state.provisioningResult.warnings.map((warning, idx) => (
                                                            <Text key={idx} size={200}>
                                                                {warning}
                                                            </Text>
                                                        ))}
                                                    </output>
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </AccordionPanel>
                    </AccordionItem>
                </Accordion>
            </div>

            {/* Additional Migration Instructions */}
            <div className={styles.configSection} data-testid="migration-phase-code-migration">
                <Field
                    label={
                        <>
                            {l10n.t('Additional Migration Instructions')}
                            <InfoTooltipIcon
                                content={l10n.t(
                                    'Provide any additional context or requirements for the code migration plan. These instructions will be included when generating the migration plan via Copilot Chat.',
                                )}
                                ariaLabel={l10n.t('Additional migration instructions help')}
                                styles={styles}
                            />
                        </>
                    }
                >
                    <Textarea
                        value={state.migrationInstructions ?? ''}
                        disabled={isRunActive}
                        onChange={handleMigrationInstructionsChange}
                        placeholder={l10n.t('e.g., Use the repository pattern, prefer async/await, target .NET 8…')}
                        resize="vertical"
                        rows={3}
                    />
                </Field>
            </div>

            {/* Footer */}
            <div className={styles.footer}>
                <Button appearance="secondary" size="small" onClick={handleReset} disabled={isRunActive}>
                    {l10n.t('Reset Project')}
                </Button>
                <div className={styles.footerRight}>
                    {state.hasCodeMigrationPlan && (
                        <Link
                            data-testid="migration-view-plan"
                            onClick={() => handlePreviewMarkdown(state.codeMigrationPlanPath)}
                        >
                            <DocumentRegular style={{ marginRight: 4, verticalAlign: 'middle' }} />
                            {l10n.t('View Plan')}
                        </Link>
                    )}
                    {isMigrationRunActive(actionActivity('code-migration')) ? (
                        <MigrationActionButton
                            {...chatActionProps}
                            activity={actionActivity('code-migration')}
                            actionLabel={
                                state.codeMigrationAction === 'plan'
                                    ? l10n.t('Plan Migration')
                                    : l10n.t('Migrate Application')
                            }
                            appearance="primary"
                            size="small"
                            icon={<SparkleRegular />}
                            data-testid="migration-action-button"
                        >
                            {state.codeMigrationAction === 'plan'
                                ? l10n.t('Plan Migration')
                                : l10n.t('Migrate Application')}
                        </MigrationActionButton>
                    ) : (
                        <Menu>
                            <MenuTrigger>
                                {(triggerProps: MenuButtonProps) => (
                                    <SplitButton
                                        appearance="primary"
                                        size="small"
                                        icon={<SparkleRegular />}
                                        disabled={!allComplete}
                                        menuButton={{
                                            ...triggerProps,
                                            'aria-label': l10n.t('Select migration action'),
                                        }}
                                        primaryActionButton={
                                            {
                                                onClick: handleCodeMigration,
                                                'data-testid': 'migration-action-button',
                                            } as SplitButtonProps['primaryActionButton']
                                        }
                                    >
                                        {state.codeMigrationAction === 'plan'
                                            ? l10n.t('Plan Migration')
                                            : l10n.t('Migrate Application')}
                                    </SplitButton>
                                )}
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList>
                                    <MenuItem onClick={() => handleSetCodeMigrationAction('plan')}>
                                        {l10n.t('Plan Migration')}
                                    </MenuItem>
                                    <MenuItem onClick={() => handleSetCodeMigrationAction('migrate')}>
                                        {l10n.t('Migrate Application')}
                                    </MenuItem>
                                </MenuList>
                            </MenuPopover>
                        </Menu>
                    )}
                </div>
            </div>
        </div>
    );
}

export const MigrationAssistant = () => {
    const trpcClient = useTrpcClient<MigrationAppRouter>();
    const channel = useMemo(() => new MigrationChannel(trpcClient), [trpcClient]);
    useEffect(() => () => channel.dispose(), [channel]);

    // Minimal provider exposing reportWebviewError + executeReportIssueCommand for ErrorBoundary.
    // The migration UI does not use the Fluent Toaster, so dispatchToast is a no-op.
    const provider = useMemo(() => {
        const noopDispatchToast = (() => {
            /* no-op */
        }) as unknown as DispatchToastFn;
        return new BaseContextProvider<MigrationAppRouter>(noopDispatchToast, trpcClient);
    }, [trpcClient]);

    return (
        <WithMigrationContext channel={channel}>
            <ErrorBoundary provider={provider}>
                <MigrationAssistantInner channel={channel} />
            </ErrorBoundary>
        </WithMigrationContext>
    );
};
