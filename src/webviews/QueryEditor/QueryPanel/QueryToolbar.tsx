import {
    makeStyles,
    Menu,
    MenuItem,
    MenuItemLink,
    MenuList,
    MenuPopover,
    MenuTrigger,
    tokens,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    type ToolbarProps,
} from '@fluentui/react-components';
import {
    DatabasePlugConnectedRegular,
    DocumentMultipleRegular,
    FolderOpenRegular,
    LibraryRegular,
    PlayRegular,
    SaveRegular,
    StopRegular,
} from '@fluentui/react-icons';
import { useQueryEditorDispatcher, useQueryEditorState } from '../QueryEditorContext';

const useClasses = makeStyles({
    iconPlay: {
        color: tokens.colorStatusSuccessBorderActive,
    },
    iconStop: {
        color: tokens.colorStatusDangerBorderActive,
    },
});

const BaseActionsSection = () => {
    const classes = useClasses();
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    return (
        <>
            <ToolbarButton
                aria-label="Run"
                icon={<PlayRegular className={classes.iconPlay} />}
                disabled={state.isExecuting}
                onClick={() => void dispatcher.runQuery(state.queryValue)}>
                Run
            </ToolbarButton>
            <ToolbarButton
                aria-label="Cancel"
                icon={<StopRegular className={classes.iconStop} />}
                disabled={!state.isExecuting}
                onClick={() => void dispatcher.stopQuery(state.currentExecutionId)}>
                Cancel
            </ToolbarButton>
            <ToolbarButton aria-label="Open" icon={<FolderOpenRegular />} onClick={() => void dispatcher.openFile()}>
                Open
            </ToolbarButton>
            <ToolbarButton
                aria-label="Save query"
                icon={<SaveRegular />}
                onClick={() => void dispatcher.saveToFile(state.queryValue)}>
                Save
            </ToolbarButton>
        </>
    );
};

const LearnSection = () => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const samples = ['SELECT * FROM c', 'SELECT * FROM c WHERE xyz', 'SELECT * FROM c ...etc'];
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
                            {samples.map((sample) => (
                                <MenuItem disabled={state.isExecuting} onClick={() => dispatcher.insertText(sample)}>
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
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    return (
        <>
            <ToolbarButton
                aria-label="Disconnect"
                icon={<DocumentMultipleRegular />}
                onClick={() => void dispatcher.disconnectFromDatabase()}>
                Disconnect
            </ToolbarButton>
            <ToolbarDivider />
            <span aria-label="Database">
                Connected to {state.dbName}/{state.collectionName}
            </span>
        </>
    );
};

const DisconnectedActionsSection = () => {
    const dispatcher = useQueryEditorDispatcher();

    return (
        <ToolbarButton
            aria-label="Connect"
            icon={<DatabasePlugConnectedRegular />}
            onClick={() => void dispatcher.connectToDatabase()}>
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
