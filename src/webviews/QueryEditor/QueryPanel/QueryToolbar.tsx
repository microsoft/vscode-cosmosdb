import {
    Button,
    makeStyles,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    tokens,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    type ToolbarProps,
} from '@fluentui/react-components';
import {
    ChevronDownRegular,
    DatabasePlugConnectedRegular,
    DocumentMultipleRegular,
    FolderOpenRegular,
    LibraryRegular,
    PlayRegular,
    SaveRegular,
    StopRegular,
} from '@fluentui/react-icons';
import { useContext, useState } from 'react';
import { QueryEditorContext } from '../QueryEditorContext';

const useClasses = makeStyles({
    iconPlay: {
        color: tokens.colorStatusSuccessBorderActive,
    },
    iconStop: {
        color: tokens.colorStatusDangerBorderActive,
    },
    iconChevronDown: {
        padding: '0 0 0 10px',
    },
});

const BaseActionsSection = () => {
    const classes = useClasses();
    const contextValue = useContext(QueryEditorContext);
    const [isQueryRunning, setIsQueryRunning] = useState(false); // TODO: should be global state hook

    return (
        <>
            <ToolbarButton
                aria-label="Run"
                icon={<PlayRegular className={classes.iconPlay} />}
                disabled={isQueryRunning}
                onClick={() => setIsQueryRunning(true)}>
                Run
            </ToolbarButton>
            <ToolbarButton
                aria-label="Cancel"
                icon={<StopRegular className={classes.iconStop} />}
                disabled={!isQueryRunning}
                onClick={() => setIsQueryRunning(false)}>
                Cancel
            </ToolbarButton>
            <ToolbarButton aria-label="Open" icon={<FolderOpenRegular />} onClick={() => void contextValue.openFile()}>
                Open
            </ToolbarButton>
            <ToolbarButton aria-label="Save query" icon={<SaveRegular />}>
                Save
            </ToolbarButton>
        </>
    );
};

const LearnSection = () => {
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
                            <MenuItem>SELECT * FROM c</MenuItem>
                            <MenuItem>SELECT * FROM c WHERE xyz</MenuItem>
                            <MenuItem>SELECT * FROM c ...etc</MenuItem>
                        </MenuPopover>
                    </Menu>
                    <MenuItem>NoSQL quick reference</MenuItem>
                    <MenuItem>Learning center</MenuItem>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};

const ConnectedActionsSection = () => {
    const classes = useClasses();
    const [isOpen, setOpen] = useState<boolean>(false);

    return (
        <Popover trapFocus open={isOpen} onOpenChange={(_, _data) => setOpen(!isOpen)}>
            <PopoverTrigger disableButtonEnhancement>
                <ToolbarButton aria-label="Collection" icon={<DocumentMultipleRegular />}>
                    Disconnect <ChevronDownRegular className={classes.iconChevronDown} />
                </ToolbarButton>
            </PopoverTrigger>
            <PopoverSurface>
                <div>
                    <h3>Quick Actions</h3>
                    <Button onClick={() => setOpen(false)}>Close</Button>
                </div>
            </PopoverSurface>
        </Popover>
    );
};

type DisconnectedActionsSectionProps = {
    onConnectionChange: (isConnected: boolean) => void;
};

const DisconnectedActionsSection = (props: DisconnectedActionsSectionProps) => {
    return (
        <ToolbarButton
            aria-label="Connect"
            icon={<DatabasePlugConnectedRegular />}
            onClick={() => props.onConnectionChange(true)}>
            Connect
        </ToolbarButton>
    );
};

export const QueryToolbar = (props: Partial<ToolbarProps>) => {
    const [isConnected, setIsConnected] = useState(false); // TODO: should be global useConnection hook

    return (
        <Toolbar aria-label="Default" {...props}>
            <BaseActionsSection />
            <LearnSection />
            <ToolbarDivider />
            {isConnected ? (
                <ConnectedActionsSection />
            ) : (
                <DisconnectedActionsSection onConnectionChange={(isConnected) => setIsConnected(isConnected)} />
            )}
        </Toolbar>
    );
};
