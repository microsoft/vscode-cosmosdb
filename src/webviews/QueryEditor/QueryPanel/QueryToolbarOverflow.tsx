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

type OverflowToolbarItemProps = {
    type: 'button' | 'menuitem';
};

const RunQueryButton = forwardRef((props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement>) => {
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
                {props.type === 'button' ? (
                    (triggerProps: MenuButtonProps) => (
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
                    )
                ) : (
                    <MenuItem
                        aria-label="Run"
                        icon={<PlayRegular />}
                        disabled={state.isExecuting || !state.isConnected}
                        onClick={() => runQuery()}
                    >
                        Run
                    </MenuItem>
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

const CancelQueryButton = forwardRef(
    (props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement | HTMLDivElement>) => {
        const classes = useClasses();
        const state = useQueryEditorState();
        const dispatcher = useQueryEditorDispatcher();
        const Component = props.type === 'button' ? ToolbarButton : MenuItem;

        return (
            <Component
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                ref={ref}
                aria-label="Cancel"
                icon={<StopRegular className={classes.iconStop} />}
                disabled={!state.isExecuting}
                onClick={() => void dispatcher.stopQuery(state.currentExecutionId)}
            >
                Cancel
            </Component>
        );
    },
);

const OpenFileButton = forwardRef(
    (props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement | HTMLDivElement>) => {
        const dispatcher = useQueryEditorDispatcher();
        const Component = props.type === 'button' ? ToolbarButton : MenuItem;

        return (
            <Component
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                ref={ref}
                aria-label="Open"
                icon={<FolderOpenRegular />}
                onClick={() => void dispatcher.openFile()}
            >
                Open
            </Component>
        );
    },
);

const SaveToFileButton = forwardRef(
    (props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement | HTMLDivElement>) => {
        const state = useQueryEditorState();
        const dispatcher = useQueryEditorDispatcher();
        const Component = props.type === 'button' ? ToolbarButton : MenuItem;

        return (
            <Component
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                ref={ref}
                aria-label="Save query"
                icon={<SaveRegular />}
                onClick={() => void dispatcher.saveToFile(state.queryValue, 'New query', 'nosql')}
            >
                Save
            </Component>
        );
    },
);

const DuplicateTabButton = forwardRef(
    (props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement | HTMLDivElement>) => {
        const state = useQueryEditorState();
        const dispatcher = useQueryEditorDispatcher();
        const Component = props.type === 'button' ? ToolbarButton : MenuItem;

        return (
            <Component
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                ref={ref}
                aria-label="Copy into new tab"
                icon={<TabDesktopMultipleRegular />}
                onClick={() => void dispatcher.duplicateTab(state.queryValue)}
                disabled={!state.isConnected}
            >
                Duplicate
            </Component>
        );
    },
);

const LearnButton = forwardRef((props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const samples = ['SELECT * FROM c', 'SELECT * FROM c ORDER BY c.id', 'SELECT * FROM c OFFSET 0 LIMIT 10'];
    const noSqlQuickReferenceUrl = 'https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/';
    const noSqlLearningCenterUrl = 'https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/';
    const cosmosDBLimitations = 'https://github.com/Azure/azure-sdk-for-js/tree/main/sdk/cosmosdb/cosmos#limitations';

    return (
        <Menu>
            <MenuTrigger>
                {props.type === 'button' ? (
                    <ToolbarButton ref={ref} aria-label="Learn more" icon={<LibraryRegular />}>
                        Learn
                    </ToolbarButton>
                ) : (
                    <MenuItem aria-label="Learn more" icon={<LibraryRegular />}>
                        Learn
                    </MenuItem>
                )}
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
                    <MenuItemLink href={cosmosDBLimitations}>CosmosDB SDK limitations</MenuItemLink>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
});

const ConnectionButton = forwardRef(
    (props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement | HTMLDivElement>) => {
        const classes = useClasses();
        const state = useQueryEditorState();
        const dispatcher = useQueryEditorDispatcher();
        const Component = props.type === 'button' ? ToolbarButton : MenuItem;

        if (state.isConnected) {
            return (
                <Component
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    ref={ref}
                    aria-label="Disconnect"
                    icon={<DatabasePlugConnectedRegular className={classes.iconDisconnect} />}
                    onClick={() => void dispatcher.disconnectFromDatabase()}
                >
                    Disconnect
                </Component>
            );
        }

        return (
            <Component
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                ref={ref}
                aria-label="Connect"
                icon={<DatabasePlugConnectedRegular />}
                onClick={() => void dispatcher.connectToDatabase()}
            >
                Connect
            </Component>
        );
    },
);

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
                    <ToolbarMenuOverflowDivider id="2" />
                    <ToolbarOverflowMenuItem id="7">
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
            <Toolbar aria-label="Default" size={'small'} {...props}>
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
                <ToolbarOverflowDivider groupId="2" />
                <OverflowItem id={'7'} groupId={'3'}>
                    <ConnectionButton type={'button'} />
                </OverflowItem>
                <OverflowMenu />
            </Toolbar>
        </Overflow>
    );
};
