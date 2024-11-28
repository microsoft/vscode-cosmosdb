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
    useIsOverflowGroupVisible,
    useIsOverflowItemVisible,
    useOverflowMenu,
} from '@fluentui/react-components';
import {
    DatabasePlugConnectedRegular,
    FolderOpenRegular,
    LibraryRegular,
    MoreHorizontal20Filled,
    PlayRegular,
    SaveRegular,
    StopRegular,
    TabDesktopMultipleRegular,
} from '@fluentui/react-icons';
import { type ForwardedRef, forwardRef, type PropsWithChildren } from 'react';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

const useClasses = makeStyles({
    iconStop: {
        color: tokens.colorStatusDangerBorderActive,
    },
    iconDisconnect: {
        color: tokens.colorStatusDangerBorderActive,
    },
});

const RunQueryButton = forwardRef((_, ref: ForwardedRef<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const truncateString = (str: string, maxLength: number) => {
        if (str.length > maxLength) {
            return str.slice(0, maxLength - 1) + '\u2026';
        }
        return str;
    };

    const runQuery = () => {
        if (state.querySelectedValue) {
            return void dispatcher.runQuery(state.querySelectedValue, { countPerPage: state.pageSize });
        }

        void dispatcher.runQuery(state.queryValue, { countPerPage: state.pageSize });
    };

    return (
        <Menu>
            <MenuTrigger>
                {(triggerProps: MenuButtonProps) => (
                    <SplitButton
                        ref={ref}
                        aria-label="Run"
                        icon={<PlayRegular />}
                        disabled={state.isExecuting || !state.isConnected}
                        appearance={'primary'}
                        menuButton={triggerProps}
                        primaryActionButton={{ onClick: () => runQuery() }}
                    >
                        Run
                    </SplitButton>
                )}
            </MenuTrigger>
            <MenuPopover>
                {state.queryHistory.length === 0 && <MenuItem disabled>No history</MenuItem>}
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

const RunQueryMenuItem = () => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const truncateString = (str: string, maxLength: number) => {
        if (str.length > maxLength) {
            return str.slice(0, maxLength - 1) + '\u2026';
        }
        return str;
    };

    const runQuery = () => {
        if (state.querySelectedValue) {
            return void dispatcher.runQuery(state.querySelectedValue, { countPerPage: state.pageSize });
        }

        void dispatcher.runQuery(state.queryValue, { countPerPage: state.pageSize });
    };

    return (
        <Menu>
            <MenuTrigger>
                <MenuItem
                    aria-label="Run"
                    icon={<PlayRegular />}
                    disabled={state.isExecuting || !state.isConnected}
                    onClick={() => runQuery()}
                >
                    Run
                </MenuItem>
            </MenuTrigger>
            <MenuPopover>
                {state.queryHistory.length === 0 && <MenuItem disabled>No history</MenuItem>}
                {state.queryHistory.length > 0 &&
                    state.queryHistory.map((query, index) => (
                        <MenuItem onClick={() => dispatcher.insertText(query)} key={index}>
                            {truncateString(query, 50)}
                        </MenuItem>
                    ))}
            </MenuPopover>
        </Menu>
    );
};

const CancelQueryButton = forwardRef((_, ref: ForwardedRef<HTMLButtonElement>) => {
    const classes = useClasses();
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    return (
        <ToolbarButton
            ref={ref}
            aria-label="Cancel"
            icon={<StopRegular className={classes.iconStop} />}
            disabled={!state.isExecuting}
            onClick={() => void dispatcher.stopQuery(state.currentExecutionId)}
        >
            Cancel
        </ToolbarButton>
    );
});

const CancelQueryMenuItem = () => {
    const classes = useClasses();
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    return (
        <MenuItem
            aria-label="Cancel"
            icon={<StopRegular className={classes.iconStop} />}
            disabled={!state.isExecuting}
            onClick={() => void dispatcher.stopQuery(state.currentExecutionId)}
        >
            Cancel
        </MenuItem>
    );
};

const OpenFileButton = forwardRef((_, ref: ForwardedRef<HTMLButtonElement>) => {
    const dispatcher = useQueryEditorDispatcher();

    return (
        <ToolbarButton
            ref={ref}
            aria-label="Open"
            icon={<FolderOpenRegular />}
            onClick={() => void dispatcher.openFile()}
        >
            Open
        </ToolbarButton>
    );
});

const OpenFileMenuItem = () => {
    const dispatcher = useQueryEditorDispatcher();

    return (
        <MenuItem aria-label="Open" icon={<FolderOpenRegular />} onClick={() => void dispatcher.openFile()}>
            Open
        </MenuItem>
    );
};

const SaveToFileButton = forwardRef((_, ref: ForwardedRef<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    return (
        <ToolbarButton
            ref={ref}
            aria-label="Save query"
            icon={<SaveRegular />}
            onClick={() => void dispatcher.saveToFile(state.queryValue, 'New query', 'nosql')}
        >
            Save
        </ToolbarButton>
    );
});

const SaveToFileMenuItem = () => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    return (
        <MenuItem
            aria-label="Save query"
            icon={<SaveRegular />}
            onClick={() => void dispatcher.saveToFile(state.queryValue, 'New query', 'nosql')}
        >
            Save
        </MenuItem>
    );
};

const DuplicateTabButton = forwardRef((_, ref: ForwardedRef<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    return (
        <ToolbarButton
            ref={ref}
            aria-label="Copy into new tab"
            icon={<TabDesktopMultipleRegular />}
            onClick={() => void dispatcher.duplicateTab(state.queryValue)}
            disabled={!state.isConnected}
        >
            Duplicate
        </ToolbarButton>
    );
});

const DuplicateTabMenuItem = () => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    return (
        <MenuItem
            aria-label="Copy into new tab"
            icon={<TabDesktopMultipleRegular />}
            onClick={() => void dispatcher.duplicateTab(state.queryValue)}
            disabled={!state.isConnected}
        >
            Duplicate
        </MenuItem>
    );
};

const LearnButton = forwardRef((_, ref: ForwardedRef<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const samples = ['SELECT * FROM c', 'SELECT * FROM c ORDER BY c.id', 'SELECT * FROM c OFFSET 0 LIMIT 10'];
    const noSqlQuickReferenceUrl = 'https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/';
    const noSqlLearningCenterUrl = 'https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/';

    return (
        <Menu>
            <MenuTrigger>
                <ToolbarButton ref={ref} aria-label="Learn more" icon={<LibraryRegular />}>
                    Learn
                </ToolbarButton>
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    <Menu>
                        <MenuTrigger>
                            <MenuItem>Query examples</MenuItem>
                        </MenuTrigger>
                        <MenuPopover>
                            {samples.map((sample, index) => (
                                <MenuItem
                                    disabled={state.isExecuting}
                                    onClick={() => dispatcher.insertText(sample)}
                                    key={index}
                                >
                                    {sample}
                                </MenuItem>
                            ))}
                        </MenuPopover>
                    </Menu>
                    <MenuItemLink href={noSqlQuickReferenceUrl}>NoSQL quick reference</MenuItemLink>
                    <MenuItemLink href={noSqlLearningCenterUrl}>Learning center</MenuItemLink>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
});

const LearnMenuItem = () => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const samples = ['SELECT * FROM c', 'SELECT * FROM c ORDER BY c.id', 'SELECT * FROM c OFFSET 0 LIMIT 10'];
    const noSqlQuickReferenceUrl = 'https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/';
    const noSqlLearningCenterUrl = 'https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/';

    return (
        <Menu>
            <MenuTrigger>
                <MenuItem aria-label="Learn more" icon={<LibraryRegular />}>
                    Learn
                </MenuItem>
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    <Menu>
                        <MenuTrigger>
                            <MenuItem>Query examples</MenuItem>
                        </MenuTrigger>
                        <MenuPopover>
                            {samples.map((sample, index) => (
                                <MenuItem
                                    disabled={state.isExecuting}
                                    onClick={() => dispatcher.insertText(sample)}
                                    key={index}
                                >
                                    {sample}
                                </MenuItem>
                            ))}
                        </MenuPopover>
                    </Menu>
                    <MenuItemLink href={noSqlQuickReferenceUrl}>NoSQL quick reference</MenuItemLink>
                    <MenuItemLink href={noSqlLearningCenterUrl}>Learning center</MenuItemLink>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};

const ConnectionButton = forwardRef((_, ref: ForwardedRef<HTMLButtonElement>) => {
    const classes = useClasses();
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    if (state.isConnected) {
        return (
            <ToolbarButton
                ref={ref}
                aria-label="Disconnect"
                icon={<DatabasePlugConnectedRegular className={classes.iconDisconnect} />}
                onClick={() => void dispatcher.disconnectFromDatabase()}
            >
                Disconnect
            </ToolbarButton>
        );
    }

    return (
        <ToolbarButton
            ref={ref}
            aria-label="Connect"
            appearance={'primary'}
            icon={<DatabasePlugConnectedRegular />}
            onClick={() => void dispatcher.connectToDatabase()}
        >
            Connect
        </ToolbarButton>
    );
});

const ConnectionMenuItem = () => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    if (state.isConnected) {
        return (
            <MenuItem
                aria-label="Disconnect"
                icon={<DatabasePlugConnectedRegular />}
                onClick={() => void dispatcher.disconnectFromDatabase()}
            >
                Disconnect
            </MenuItem>
        );
    }

    return (
        <MenuItem
            aria-label="Connect"
            icon={<DatabasePlugConnectedRegular />}
            onClick={() => void dispatcher.connectToDatabase()}
        >
            Connect
        </MenuItem>
    );
};

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

    if (!isOverflowing) {
        return null;
    }

    return (
        <Menu>
            <MenuTrigger disableButtonEnhancement>
                <Button ref={ref} icon={<MoreHorizontal20Filled />} aria-label="More items" appearance="subtle" />
            </MenuTrigger>

            <MenuPopover>
                <MenuList>
                    <ToolbarOverflowMenuItem id="1">
                        <RunQueryMenuItem />
                    </ToolbarOverflowMenuItem>
                    <ToolbarOverflowMenuItem id="2">
                        <CancelQueryMenuItem />
                    </ToolbarOverflowMenuItem>
                    <ToolbarMenuOverflowDivider id="1" />
                    <ToolbarOverflowMenuItem id="3">
                        <OpenFileMenuItem />
                    </ToolbarOverflowMenuItem>
                    <ToolbarOverflowMenuItem id="4">
                        <SaveToFileMenuItem />
                    </ToolbarOverflowMenuItem>
                    <ToolbarOverflowMenuItem id="5">
                        <DuplicateTabMenuItem />
                    </ToolbarOverflowMenuItem>
                    <ToolbarOverflowMenuItem id="6">
                        <LearnMenuItem />
                    </ToolbarOverflowMenuItem>
                    <ToolbarMenuOverflowDivider id="2" />
                    <ToolbarOverflowMenuItem id="7">
                        <ConnectionMenuItem />
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
            <Toolbar aria-label="Default" size={'small'} {...props}>
                <OverflowItem id={'1'} groupId={'1'}>
                    <RunQueryButton />
                </OverflowItem>
                <OverflowItem id={'2'} groupId={'1'}>
                    <CancelQueryButton />
                </OverflowItem>
                <ToolbarOverflowDivider groupId="1" />
                <OverflowItem id={'3'} groupId={'2'}>
                    <OpenFileButton />
                </OverflowItem>
                <OverflowItem id={'4'} groupId={'2'}>
                    <SaveToFileButton />
                </OverflowItem>
                <OverflowItem id={'5'} groupId={'2'}>
                    <DuplicateTabButton />
                </OverflowItem>
                <OverflowItem id={'6'} groupId={'2'}>
                    <LearnButton />
                </OverflowItem>
                <ToolbarOverflowDivider groupId="2" />
                <OverflowItem id={'7'} groupId={'3'}>
                    <ConnectionButton />
                </OverflowItem>
                <OverflowMenu />
            </Toolbar>
        </Overflow>
    );
};
