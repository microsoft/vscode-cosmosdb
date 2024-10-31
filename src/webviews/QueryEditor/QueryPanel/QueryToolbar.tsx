/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    makeStyles,
    Menu,
    MenuItem,
    MenuItemLink,
    MenuList,
    MenuPopover,
    MenuTrigger,
    SplitButton,
    tokens,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    type MenuButtonProps,
    type ToolbarProps,
} from '@fluentui/react-components';
import {
    DatabasePlugConnectedRegular,
    FolderOpenRegular,
    LibraryRegular,
    PlayRegular,
    SaveRegular,
    StopRegular,
    TabDesktopMultipleRegular,
} from '@fluentui/react-icons';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

const useClasses = makeStyles({
    iconPlay: {
        color: tokens.colorStatusSuccessBorderActive,
    },
    iconStop: {
        color: tokens.colorStatusDangerBorderActive,
    },
    iconConnect: {
        color: tokens.colorStatusSuccessBorderActive,
    },
    iconDisconnect: {
        color: tokens.colorStatusDangerBorderActive,
    },
});

const BaseActionsSection = () => {
    const classes = useClasses();
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const truncateString = (str: string, maxLength: number) => {
        if (str.length > maxLength) {
            return str.slice(0, maxLength - 3) + '...';
        }
        return str;
    };

    return (
        <>
            <Menu>
                <MenuTrigger>
                    {(triggerProps: MenuButtonProps) => (
                        <SplitButton
                            aria-label="Run"
                            icon={<PlayRegular className={classes.iconPlay} />}
                            disabled={state.isExecuting || !state.isConnected}
                            appearance={'primary'}
                            menuButton={triggerProps}
                            primaryActionButton={{
                                onClick: () =>
                                    void dispatcher.runQuery(state.queryValue, { countPerPage: state.pageSize }),
                            }}
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
            <ToolbarButton
                aria-label="Cancel"
                icon={<StopRegular className={classes.iconStop} />}
                disabled={!state.isExecuting}
                onClick={() => void dispatcher.stopQuery(state.currentExecutionId)}
            >
                Cancel
            </ToolbarButton>
            <ToolbarButton aria-label="Open" icon={<FolderOpenRegular />} onClick={() => void dispatcher.openFile()}>
                Open
            </ToolbarButton>
            <ToolbarButton
                aria-label="Save query"
                icon={<SaveRegular />}
                onClick={() => void dispatcher.saveToFile(state.queryValue, 'New query', 'nosql')}
            >
                Save
            </ToolbarButton>
            <ToolbarButton
                aria-label="Copy into new tab"
                icon={<TabDesktopMultipleRegular />}
                onClick={() => void dispatcher.duplicateTab(state.queryValue)}
                disabled={!state.isConnected}
            >
                Duplicate
            </ToolbarButton>
        </>
    );
};

const LearnSection = () => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const samples = ['SELECT * FROM c', 'SELECT * FROM c ORDER BY c.id', 'SELECT * FROM c OFFSET 0 LIMIT 10'];
    const noSqlQuickReferenceUrl = 'https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/';
    const noSqlLearningCenterUrl = 'https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/';

    return (
        <Menu>
            <MenuTrigger>
                <ToolbarButton aria-label="Learn more" icon={<LibraryRegular />}>
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
};

const ConnectedActionsSection = () => {
    const classes = useClasses();
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    return (
        <>
            <ToolbarButton
                aria-label="Disconnect"
                icon={<DatabasePlugConnectedRegular className={classes.iconDisconnect} />}
                onClick={() => void dispatcher.disconnectFromDatabase()}
            >
                Disconnect
            </ToolbarButton>
            <ToolbarDivider />
            <span aria-label="Database" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Connected to {state.dbName}/{state.collectionName}
            </span>
        </>
    );
};

const DisconnectedActionsSection = () => {
    const classes = useClasses();
    const dispatcher = useQueryEditorDispatcher();

    return (
        <ToolbarButton
            aria-label="Connect"
            appearance={'primary'}
            icon={<DatabasePlugConnectedRegular className={classes.iconConnect} />}
            onClick={() => void dispatcher.connectToDatabase()}
        >
            Connect
        </ToolbarButton>
    );
};

export const QueryToolbar = (props: Partial<ToolbarProps>) => {
    const state = useQueryEditorState();

    return (
        <Toolbar aria-label="Default" {...props}>
            <BaseActionsSection />
            <LearnSection />
            <ToolbarDivider />
            {state.isConnected ? <ConnectedActionsSection /> : <DisconnectedActionsSection />}
        </Toolbar>
    );
};
