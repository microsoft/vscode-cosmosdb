/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    makeStyles,
    Menu,
    type MenuButtonProps,
    MenuDivider,
    MenuItem,
    MenuItemLink,
    type MenuItemProps,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Overflow,
    OverflowItem,
    SplitButton,
    tokens,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    type ToolbarProps,
    Tooltip,
    useIsOverflowGroupVisible,
    useIsOverflowItemVisible,
    useOverflowMenu,
} from '@fluentui/react-components';
import {
    CommentCheckmarkRegular,
    DatabasePlugConnectedRegular,
    EmojiSmileSlightRegular,
    FolderOpenRegular,
    LibraryRegular,
    MoreHorizontal20Filled,
    PlayRegular,
    SaveRegular,
    StopRegular,
    TabDesktopMultipleRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ForwardedRef, forwardRef, type PropsWithChildren, useCallback } from 'react';
import { CommandType, HotkeyScope, useCommandHotkey } from '../../../common/hotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

const useClasses = makeStyles({
    iconStop: {
        color: tokens.colorStatusDangerBorderActive,
    },
    iconDisconnect: {
        color: tokens.colorStatusDangerBorderActive,
    },
});

type OverflowToolbarItemProps = {
    type: 'button' | 'menuitem';
};

const RunQueryButton = forwardRef((props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const isDisabled = !state.isConnected || state.isExecuting;

    const truncateString = (str: string, maxLength: number) => {
        if (str.length > maxLength) {
            return str.slice(0, maxLength - 1) + '…';
        }
        return str;
    };

    const runQuery = useCallback(
        async (event?: KeyboardEvent) => {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }

            if (state.querySelectedValue) {
                return dispatcher.runQuery(state.querySelectedValue, { countPerPage: state.pageSize });
            }

            return dispatcher.runQuery(state.queryValue, { countPerPage: state.pageSize });
        },
        [dispatcher, state],
    );

    useCommandHotkey(HotkeyScope.QueryEditor, CommandType.ExecuteQuery, runQuery, {
        disabled: isDisabled,
    });

    return (
        <Menu>
            <MenuTrigger>
                {props.type === 'button' ? (
                    (triggerProps: MenuButtonProps) => (
                        <SplitButton
                            ref={ref}
                            aria-label={l10n.t('Run')}
                            icon={<PlayRegular />}
                            disabled={isDisabled}
                            appearance={'primary'}
                            menuButton={{
                                ...triggerProps,
                                'aria-label': l10n.t('Show history of previous queries'),
                            }}
                            primaryActionButton={{ onClick: () => void runQuery() }}
                        >
                            {l10n.t('Run')}
                        </SplitButton>
                    )
                ) : (
                    <MenuItem
                        aria-label={l10n.t('Run')}
                        icon={<PlayRegular />}
                        disabled={isDisabled}
                        onClick={() => void runQuery()}
                    >
                        {l10n.t('Run')}
                    </MenuItem>
                )}
            </MenuTrigger>
            <MenuPopover>
                {state.queryHistory.length === 0 && <MenuItem disabled>{l10n.t('No history')}</MenuItem>}
                {state.queryHistory.length > 0 &&
                    state.queryHistory.map((query, index) => (
                        <MenuItem onClick={() => dispatcher.insertText(query)} key={index}>
                            {truncateString(query, 50)}
                        </MenuItem>
                    ))}
            </MenuPopover>
        </Menu>
    );
});
RunQueryButton.displayName = 'RunQueryButton';

const CancelQueryButton = forwardRef(
    (props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement | HTMLDivElement>) => {
        const classes = useClasses();
        const state = useQueryEditorState();
        const dispatcher = useQueryEditorDispatcher();
        const Component = props.type === 'button' ? ToolbarButton : MenuItem;

        const cancelQuery = useCallback(
            async (event?: KeyboardEvent) => {
                if (event) {
                    event.stopPropagation();
                    event.preventDefault();
                }

                if (state.currentExecutionId) {
                    return dispatcher.stopQuery(state.currentExecutionId);
                }
            },
            [dispatcher, state],
        );

        useCommandHotkey(HotkeyScope.QueryEditor, CommandType.Cancel, cancelQuery, { disabled: !state.isExecuting });

        return (
            <Component
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                ref={ref}
                aria-label={l10n.t('Cancel')}
                icon={<StopRegular className={classes.iconStop} />}
                disabled={!state.isExecuting}
                onClick={() => void cancelQuery()}
            >
                {l10n.t('Cancel')}
            </Component>
        );
    },
);
CancelQueryButton.displayName = 'CancelQueryButton';

const OpenFileButton = forwardRef(
    (props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement | HTMLDivElement>) => {
        const dispatcher = useQueryEditorDispatcher();
        const Component = props.type === 'button' ? ToolbarButton : MenuItem;

        const openFile = useCallback(
            (event?: KeyboardEvent) => {
                if (event) {
                    event.stopPropagation();
                    event.preventDefault();
                }

                return dispatcher.openFile();
            },
            [dispatcher],
        );

        useCommandHotkey(HotkeyScope.QueryEditor, CommandType.OpenQuery, openFile);

        return (
            <Component
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                ref={ref}
                aria-label={l10n.t('Open')}
                icon={<FolderOpenRegular />}
                onClick={() => void openFile()}
            >
                {l10n.t('Open')}
            </Component>
        );
    },
);
OpenFileButton.displayName = 'OpenFileButton';

const SaveToFileButton = forwardRef(
    (props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement | HTMLDivElement>) => {
        const state = useQueryEditorState();
        const dispatcher = useQueryEditorDispatcher();
        const Component = props.type === 'button' ? ToolbarButton : MenuItem;

        const saveToFile = useCallback(
            (event?: KeyboardEvent) => {
                if (event) {
                    event.stopPropagation();
                    event.preventDefault();
                }

                return dispatcher.saveToFile(state.queryValue, 'New query', 'nosql');
            },
            [dispatcher, state],
        );

        useCommandHotkey(HotkeyScope.QueryEditor, CommandType.SaveToDisk, saveToFile);

        return (
            <Component
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                ref={ref}
                aria-label={l10n.t('Save query')}
                icon={<SaveRegular />}
                onClick={() => void saveToFile()}
            >
                {l10n.t('Save')}
            </Component>
        );
    },
);
SaveToFileButton.displayName = 'SaveToFileButton';

const DuplicateTabButton = forwardRef(
    (props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement | HTMLDivElement>) => {
        const state = useQueryEditorState();
        const dispatcher = useQueryEditorDispatcher();
        const Component = props.type === 'button' ? ToolbarButton : MenuItem;

        const duplicateTab = useCallback(
            (event?: KeyboardEvent) => {
                if (event) {
                    event.stopPropagation();
                    event.preventDefault();
                }

                return dispatcher.duplicateTab(state.queryValue);
            },
            [dispatcher, state],
        );

        useCommandHotkey(HotkeyScope.Global, CommandType.DuplicateQueryEditor, duplicateTab, {
            disabled: !state.isConnected,
        });

        return (
            <Component
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                ref={ref}
                aria-label={l10n.t('Duplicate')}
                icon={<TabDesktopMultipleRegular />}
                onClick={() => void duplicateTab()}
                disabled={!state.isConnected}
            >
                {l10n.t('Duplicate')}
            </Component>
        );
    },
);
DuplicateTabButton.displayName = 'DuplicateTabButton';

const LearnButton = forwardRef((props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const samples = ['SELECT * FROM c', 'SELECT * FROM c ORDER BY c.id', 'SELECT * FROM c OFFSET 0 LIMIT 10'];
    const noSqlQuickReferenceUrl = 'https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/';
    const noSqlLearningCenterUrl = 'https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/';
    const cosmosDBLimitations = 'https://github.com/Azure/azure-sdk-for-js/tree/main/sdk/cosmosdb/cosmos#limitations';

    const insertSampleText = useCallback((sample: string) => dispatcher.insertText(sample), [dispatcher]);

    return (
        <Menu>
            <MenuTrigger>
                {props.type === 'button' ? (
                    <ToolbarButton ref={ref} aria-label={l10n.t('Learn more')} icon={<LibraryRegular />}>
                        {l10n.t('Learn')}
                    </ToolbarButton>
                ) : (
                    <MenuItem aria-label={l10n.t('Learn more')} icon={<LibraryRegular />}>
                        {l10n.t('Learn')}
                    </MenuItem>
                )}
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    <Menu>
                        <MenuTrigger>
                            <MenuItem>{l10n.t('Query examples')}</MenuItem>
                        </MenuTrigger>
                        <MenuPopover>
                            {samples.map((sample, index) => (
                                <MenuItem
                                    disabled={state.isExecuting}
                                    onClick={() => insertSampleText(sample)}
                                    key={index}
                                >
                                    {sample}
                                </MenuItem>
                            ))}
                        </MenuPopover>
                    </Menu>
                    <MenuItemLink href={noSqlQuickReferenceUrl}>{l10n.t('NoSQL quick reference')}</MenuItemLink>
                    <MenuItemLink href={noSqlLearningCenterUrl}>{l10n.t('Learning center')}</MenuItemLink>
                    <MenuItemLink href={cosmosDBLimitations}>{l10n.t('CosmosDB SDK limitations')}</MenuItemLink>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
});
LearnButton.displayName = 'LearnButton';

const ProvideFeedbackButton = forwardRef((props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement>) => {
    const dispatcher = useQueryEditorDispatcher();

    const provideFeedback = useCallback(() => dispatcher.provideFeedback(), [dispatcher]);

    if (props.type === 'button') {
        return (
            <Menu>
                <MenuTrigger>
                    <Tooltip content={l10n.t('Provide Feedback')} relationship="label">
                        <ToolbarButton
                            ref={ref}
                            aria-label={l10n.t('Provide Feedback')}
                            icon={<EmojiSmileSlightRegular />}
                        ></ToolbarButton>
                    </Tooltip>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem icon={<CommentCheckmarkRegular />} onClick={() => void provideFeedback()}>
                            {l10n.t('Provide Feedback')}
                        </MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
        );
    } else {
        return (
            <MenuItem
                aria-label={l10n.t('Provide Feedback')}
                icon={<EmojiSmileSlightRegular />}
                onClick={() => void dispatcher.provideFeedback()}
            >
                {l10n.t('Provide Feedback')}
            </MenuItem>
        );
    }
});
ProvideFeedbackButton.displayName = 'ProvideFeedbackButton';

const ConnectionButton = forwardRef(
    (props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement | HTMLDivElement>) => {
        const classes = useClasses();
        const state = useQueryEditorState();
        const dispatcher = useQueryEditorDispatcher();
        const Component = props.type === 'button' ? ToolbarButton : MenuItem;

        const connectToDatabase = useCallback(() => dispatcher.connectToDatabase(), [dispatcher]);
        const disconnectFromDatabase = useCallback(() => dispatcher.disconnectFromDatabase(), [dispatcher]);

        if (state.isConnected) {
            return (
                <Component
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    ref={ref}
                    aria-label={l10n.t('Disconnect')}
                    icon={<DatabasePlugConnectedRegular className={classes.iconDisconnect} />}
                    onClick={() => void disconnectFromDatabase()}
                >
                    {l10n.t('Disconnect')}
                </Component>
            );
        }

        return (
            <Component
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                ref={ref}
                aria-label={l10n.t('Connect')}
                icon={<DatabasePlugConnectedRegular />}
                onClick={() => void connectToDatabase()}
            >
                {l10n.t('Connect')}
            </Component>
        );
    },
);
ConnectionButton.displayName = 'ConnectionButton';

interface ToolbarOverflowMenuItemProps extends Omit<MenuItemProps, 'id'> {
    id: string;
}

const ToolbarOverflowMenuItem = (props: PropsWithChildren<ToolbarOverflowMenuItemProps>) => {
    const { id, children } = props;
    const isVisible = useIsOverflowItemVisible(id);

    if (isVisible) {
        return null;
    }

    return children;
};

type ToolbarMenuOverflowDividerProps = {
    id: string;
};

const ToolbarMenuOverflowDivider = (props: ToolbarMenuOverflowDividerProps) => {
    const isGroupVisible = useIsOverflowGroupVisible(props.id);

    if (isGroupVisible === 'visible') {
        return null;
    }

    return <MenuDivider />;
};

const OverflowMenu = () => {
    const { ref, isOverflowing } = useOverflowMenu<HTMLButtonElement>();
    const state = useQueryEditorState();

    if (!isOverflowing) {
        return null;
    }

    return (
        <Menu>
            <MenuTrigger disableButtonEnhancement>
                <Button
                    ref={ref}
                    icon={<MoreHorizontal20Filled />}
                    aria-label={l10n.t('More items')}
                    appearance="subtle"
                />
            </MenuTrigger>

            <MenuPopover>
                <MenuList>
                    <ToolbarOverflowMenuItem id="1">
                        <RunQueryButton type={'menuitem'} />
                    </ToolbarOverflowMenuItem>
                    <ToolbarOverflowMenuItem id="2">
                        <CancelQueryButton type={'menuitem'} />
                    </ToolbarOverflowMenuItem>
                    <ToolbarMenuOverflowDivider id="1" />
                    <ToolbarOverflowMenuItem id="3">
                        <OpenFileButton type={'menuitem'} />
                    </ToolbarOverflowMenuItem>
                    <ToolbarOverflowMenuItem id="4">
                        <SaveToFileButton type={'menuitem'} />
                    </ToolbarOverflowMenuItem>
                    <ToolbarOverflowMenuItem id="5">
                        <DuplicateTabButton type={'menuitem'} />
                    </ToolbarOverflowMenuItem>
                    <ToolbarOverflowMenuItem id="6">
                        <LearnButton type={'menuitem'} />
                    </ToolbarOverflowMenuItem>
                    {state.isSurveyCandidate && (
                        <ToolbarOverflowMenuItem id="7">
                            <ProvideFeedbackButton type={'menuitem'} />
                        </ToolbarOverflowMenuItem>
                    )}
                    <ToolbarMenuOverflowDivider id="2" />
                    <ToolbarOverflowMenuItem id="8">
                        <ConnectionButton type={'menuitem'} />
                    </ToolbarOverflowMenuItem>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};

type ToolbarOverflowDividerProps = {
    groupId: string;
};

const ToolbarOverflowDivider = ({ groupId }: ToolbarOverflowDividerProps) => {
    const groupVisibleState = useIsOverflowGroupVisible(groupId);

    if (groupVisibleState !== 'hidden') {
        return <ToolbarDivider />;
    }

    return null;
};

export const QueryToolbarOverflow = (props: Partial<ToolbarProps>) => {
    return (
        <Overflow padding={40}>
            <Toolbar aria-label={l10n.t('Default')} size={'small'} {...props}>
                <OverflowItem id={'1'} groupId={'1'}>
                    <RunQueryButton type={'button'} />
                </OverflowItem>
                <OverflowItem id={'2'} groupId={'1'}>
                    <CancelQueryButton type={'button'} />
                </OverflowItem>
                <ToolbarOverflowDivider groupId="1" />
                <OverflowItem id={'3'} groupId={'2'}>
                    <OpenFileButton type={'button'} />
                </OverflowItem>
                <OverflowItem id={'4'} groupId={'2'}>
                    <SaveToFileButton type={'button'} />
                </OverflowItem>
                <OverflowItem id={'5'} groupId={'2'}>
                    <DuplicateTabButton type={'button'} />
                </OverflowItem>
                <OverflowItem id={'6'} groupId={'2'}>
                    <LearnButton type={'button'} />
                </OverflowItem>
                {useQueryEditorState().isSurveyCandidate && (
                    <OverflowItem id={'7'} groupId={'2'}>
                        <ProvideFeedbackButton type={'button'} />
                    </OverflowItem>
                )}
                <ToolbarOverflowDivider groupId="2" />
                <OverflowItem id={'8'} groupId={'3'}>
                    <ConnectionButton type={'button'} />
                </OverflowItem>
                <OverflowMenu />
            </Toolbar>
        </Overflow>
    );
};
