/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PriorityLevel } from '@azure/cosmos';
import {
    Menu,
    type MenuButtonProps,
    MenuDivider,
    MenuItem,
    MenuItemRadio,
    MenuList,
    MenuPopover,
    MenuTrigger,
    SplitButton,
    Tooltip,
} from '@fluentui/react-components';
import { PlayRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncateString(str: string, maxLength: number): string {
    return str.length > maxLength ? str.slice(0, maxLength - 1) + '…' : str;
}

// Priority level options — mirrors the PriorityLevel string enum from @azure/cosmos.
// Imported as type-only to avoid pulling the Node.js SDK into the webview bundle.
const PRIORITY_LEVELS: Array<{ value: PriorityLevel; label: string }> = [
    { value: 'High' as PriorityLevel, label: l10n.t('High') },
    { value: 'Low' as PriorityLevel, label: l10n.t('Low') },
];

// ─── HistoryMenuItem ─────────────────────────────────────────────────────────

type HistoryMenuItemProps = {
    query: string;
    onInsert: (query: string) => void;
};

// Plain function component — memoization happens in the parent via `useMemo`
// over the entire history list (see `historyItems` inside `RunQueryButton`).
const HistoryMenuItem = ({ query, onInsert }: HistoryMenuItemProps) => {
    const handleClick = useCallback(() => onInsert(query), [query, onInsert]);
    return <MenuItem onClick={handleClick}>{truncateString(query, 50)}</MenuItem>;
};

// ─── SplitButtonTrigger ──────────────────────────────────────────────────────

type SplitButtonTriggerProps = {
    triggerProps: MenuButtonProps;
    isDisabled: boolean;
    icon: React.ReactElement;
    onRunQuery: () => void;
    tooltipSuffix: string;
    ref?: React.Ref<HTMLButtonElement>;
};

const SplitButtonTrigger = memo(
    ({ triggerProps, isDisabled, icon, onRunQuery, tooltipSuffix, ref }: SplitButtonTriggerProps) => {
        const menuButtonProps = useMemo(
            () => ({ ...triggerProps, 'aria-label': l10n.t('Show history of previous queries') }),
            [triggerProps],
        );
        const primaryActionButtonProps = useMemo(() => ({ onClick: onRunQuery }), [onRunQuery]);

        return (
            <Tooltip content={l10n.t('Execute query') + tooltipSuffix} relationship="description" appearance="inverted">
                <SplitButton
                    ref={ref}
                    aria-label={l10n.t('Execute query')}
                    icon={icon}
                    disabled={isDisabled}
                    appearance={'primary'}
                    menuButton={menuButtonProps}
                    primaryActionButton={primaryActionButtonProps}
                >
                    {l10n.t('Run')}
                </SplitButton>
            </Tooltip>
        );
    },
);
SplitButtonTrigger.displayName = 'SplitButtonTrigger';

// ─── RunQueryButton ──────────────────────────────────────────────────────────

export const RunQueryButton = (props: ToolbarOverflowItemProps<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const isDisabled = !state.isConnected || state.isExecuting;

    // Capabilities depend on the live connection: emulator vs cloud and whether
    // the Cosmos DB account has priority-based execution enabled at the ARM
    // resource level. Fetched once per connection from the extension host.
    const [capabilities, setCapabilities] = useState<{
        isEmulator: boolean;
        isPriorityLevelEnabled: boolean;
        defaultPriorityLevel?: PriorityLevel;
    }>({
        isEmulator: false,
        isPriorityLevelEnabled: false,
    });
    useEffect(() => {
        if (!state.isConnected) {
            setCapabilities({ isEmulator: false, isPriorityLevelEnabled: false });
            return;
        }
        let cancelled = false;
        void dispatcher.getCapabilities().then((caps) => {
            if (!cancelled) {
                setCapabilities(caps);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [dispatcher, state.isConnected]);

    // Per PRD, seed the picker with a sensible default the first time the
    // feature becomes available for this connection. Prefer the account's
    // advertised default (`databaseAccount.defaultPriorityLevel`) and fall back
    // to "Low". A user's explicit choice is never overwritten because we only
    // seed when `state.priorityLevel === undefined`.
    useEffect(() => {
        if (capabilities.isPriorityLevelEnabled && state.priorityLevel === undefined) {
            dispatcher.setPriorityLevel(capabilities.defaultPriorityLevel ?? ('Low' as PriorityLevel));
        }
    }, [capabilities.isPriorityLevelEnabled, capabilities.defaultPriorityLevel, state.priorityLevel, dispatcher]);

    const runQuery = useCallback(
        async (event?: KeyboardEvent) => {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }

            // Only forward a Priority Level when the feature is enabled AND we're
            // not on the emulator (where the header is meaningless). Sending
            // `undefined` lets the SDK fall back to its server-side default
            // (treated as High by the service).
            const effectivePriority =
                capabilities.isPriorityLevelEnabled && !capabilities.isEmulator ? state.priorityLevel : undefined;

            if (state.querySelectedValue) {
                return dispatcher.runQuery(state.querySelectedValue, {
                    countPerPage: state.pageSize,
                    throughputBucket: state.selectedThroughputBucket,
                    priority: effectivePriority,
                });
            }

            // Use the query block under the cursor (persisted across focus loss),
            // falling back to the full editor text when the block is not available.
            const queryToRun = state.currentQueryBlock || state.queryValue;
            return dispatcher.runQuery(queryToRun, {
                countPerPage: state.pageSize,
                throughputBucket: state.selectedThroughputBucket,
                priority: effectivePriority,
            });
        },
        [dispatcher, state, capabilities.isPriorityLevelEnabled, capabilities.isEmulator],
    );

    const onRunQueryClick = useCallback(() => void runQuery(), [runQuery]);

    const [runQueryHotkeyTooltip, runQueryHotkeyMenu] = useMemo(() => {
        const title = HotkeyCommandService.getInstance<
            QueryEditorHotkeyScope,
            QueryEditorHotkeyCommand
        >().getShortcutDisplay('queryEditor', 'ExecuteQuery');
        return [title ? ` (${title})` : '', title ?? ''];
    }, []);

    const icon = useMemo(() => <PlayRegular />, []);

    // ─── Throughput bucket ────────────────────────────────────────────────
    const throughputCheckedValues = useMemo(
        () => ({
            throughputBucket: state.selectedThroughputBucket ? [state.selectedThroughputBucket.toString()] : ['0'],
        }),
        [state.selectedThroughputBucket],
    );

    const onThroughputCheckedValueChange = useCallback(
        (_: unknown, data: { checkedItems?: string[] }) => {
            const value = data.checkedItems?.[0];
            if (value !== undefined) {
                dispatcher.selectBucket(parseInt(value, 10));
            }
        },
        [dispatcher],
    );

    // ─── Priority level ───────────────────────────────────────────────────
    const priorityCheckedValues = useMemo(
        () => ({ priorityLevel: state.priorityLevel ? [state.priorityLevel] : [] }),
        [state.priorityLevel],
    );

    const onPriorityLevelChange = useCallback(
        (_: unknown, data: { checkedItems?: string[] }) => {
            const value = data.checkedItems?.[0] as PriorityLevel | undefined;
            if (value !== undefined) {
                dispatcher.setPriorityLevel(value);
            }
        },
        [dispatcher],
    );

    // ─── History insert callback ──────────────────────────────────────────
    const onInsertText = useCallback((query: string) => void dispatcher.insertText(query), [dispatcher]);

    // Memoise the entire history list so its element references stay stable
    // across unrelated re-renders of RunQueryButton — React's reconciler can
    // then bail out and skip rendering each `HistoryMenuItem`.
    const historyItems = useMemo(
        () => state.queryHistory.map((query) => <HistoryMenuItem key={query} query={query} onInsert={onInsertText} />),
        [state.queryHistory, onInsertText],
    );

    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('queryEditor', 'ExecuteQuery', runQuery, {
        disabled: isDisabled,
    });

    // Narrow here so TypeScript tracks the type inside JSX
    const throughputBuckets = state.throughputBuckets;

    return (
        <Menu>
            <MenuTrigger>
                {props.type === 'button' ? (
                    (triggerProps: MenuButtonProps) => (
                        <SplitButtonTrigger
                            ref={props.ref}
                            triggerProps={triggerProps}
                            isDisabled={isDisabled}
                            icon={icon}
                            onRunQuery={onRunQueryClick}
                            tooltipSuffix={runQueryHotkeyTooltip}
                        />
                    )
                ) : (
                    <MenuItem
                        aria-label={l10n.t('Execute query')}
                        secondaryContent={runQueryHotkeyMenu}
                        icon={icon}
                        disabled={isDisabled}
                        onClick={onRunQueryClick}
                    >
                        {l10n.t('Run')}
                    </MenuItem>
                )}
            </MenuTrigger>
            <MenuPopover>
                {state.queryHistory.length === 0 && <MenuItem disabled>{l10n.t('No history')}</MenuItem>}
                {state.queryHistory.length > 0 && historyItems}
                {throughputBuckets !== null && throughputBuckets !== undefined && (
                    <>
                        <MenuDivider />
                        <MenuList>
                            <Menu
                                checkedValues={throughputCheckedValues}
                                onCheckedValueChange={onThroughputCheckedValueChange}
                            >
                                <MenuTrigger>
                                    <MenuItem hasSubmenu disabled={capabilities.isEmulator}>
                                        {l10n.t('Throughput Bucket')}
                                    </MenuItem>
                                </MenuTrigger>
                                <MenuPopover>
                                    <MenuList>
                                        {throughputBuckets.length === 0 && (
                                            <MenuItem disabled>{l10n.t('No buckets')}</MenuItem>
                                        )}
                                        {throughputBuckets.length > 0 && (
                                            <MenuItemRadio key="throughputBucket-0" name="throughputBucket" value="0">
                                                {l10n.t('No bucket')}
                                            </MenuItemRadio>
                                        )}
                                        {throughputBuckets.length > 0 &&
                                            throughputBuckets.map((isActive, index) => (
                                                <MenuItemRadio
                                                    key={`throughputBucket-${index + 1}`}
                                                    name="throughputBucket"
                                                    value={(index + 1).toString()}
                                                    disabled={!isActive}
                                                >
                                                    {l10n.t('Bucket {0}', index + 1)}
                                                </MenuItemRadio>
                                            ))}
                                    </MenuList>
                                </MenuPopover>
                            </Menu>
                        </MenuList>
                    </>
                )}
                {capabilities.isPriorityLevelEnabled && (
                    <>
                        <MenuDivider />
                        <MenuList>
                            <Menu checkedValues={priorityCheckedValues} onCheckedValueChange={onPriorityLevelChange}>
                                <MenuTrigger>
                                    <MenuItem hasSubmenu disabled={capabilities.isEmulator}>
                                        {l10n.t('Priority Level')}
                                    </MenuItem>
                                </MenuTrigger>
                                <MenuPopover>
                                    <MenuList>
                                        {PRIORITY_LEVELS.map(({ value, label }) => (
                                            <MenuItemRadio key={value} name="priorityLevel" value={value}>
                                                {label}
                                            </MenuItemRadio>
                                        ))}
                                    </MenuList>
                                </MenuPopover>
                            </Menu>
                        </MenuList>
                    </>
                )}
            </MenuPopover>
        </Menu>
    );
};
