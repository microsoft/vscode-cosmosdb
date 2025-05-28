/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type OptionOnSelectData, type SelectionEvents } from '@fluentui/react-combobox';
import {
    Button,
    Dropdown,
    makeStyles,
    Menu,
    type MenuButtonProps,
    MenuDivider,
    MenuItem,
    MenuItemCheckbox,
    MenuItemLink,
    type MenuItemProps,
    MenuList,
    MenuPopover,
    MenuSplitGroup,
    MenuTrigger,
    Option,
    OptionGroup,
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
    useRestoreFocusTarget,
} from '@fluentui/react-components';
import {
    bundleIcon,
    ChevronRightFilled,
    ChevronRightRegular,
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
import {
    type ForwardedRef,
    forwardRef,
    type PropsWithChildren,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

const useClasses = makeStyles({
    iconStop: {
        color: tokens.colorStatusDangerBorderActive,
    },
    iconDisconnect: {
        color: tokens.colorStatusDangerBorderActive,
    },
});

const ChevronRightIcon = bundleIcon(ChevronRightFilled, ChevronRightRegular);

type OverflowToolbarItemProps = {
    type: 'button' | 'menuitem';
};

const RunQueryButton = forwardRef((props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const truncateString = (str: string, maxLength: number) => {
        if (str.length > maxLength) {
            return str.slice(0, maxLength - 1) + '…';
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
                            aria-label={l10n.t('Run')}
                            icon={<PlayRegular />}
                            disabled={state.isExecuting || !state.isConnected}
                            appearance={'primary'}
                            menuButton={{
                                ...triggerProps,
                                'aria-label': l10n.t('Show history of previous queries'),
                            }}
                            primaryActionButton={{ onClick: () => runQuery() }}
                        >
                            {l10n.t('Run')}
                        </SplitButton>
                    )
                ) : (
                    <MenuItem
                        aria-label={l10n.t('Run')}
                        icon={<PlayRegular />}
                        disabled={state.isExecuting || !state.isConnected}
                        onClick={() => runQuery()}
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
                aria-label={l10n.t('Cancel')}
                icon={<StopRegular className={classes.iconStop} />}
                disabled={!state.isExecuting}
                onClick={() => void dispatcher.stopQuery(state.currentExecutionId)}
            >
                {l10n.t('Cancel')}
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
                aria-label={l10n.t('Open')}
                icon={<FolderOpenRegular />}
                onClick={() => void dispatcher.openFile()}
            >
                {l10n.t('Open')}
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
                aria-label={l10n.t('Save query')}
                icon={<SaveRegular />}
                onClick={() => void dispatcher.saveToFile(state.queryValue, 'New query', 'nosql')}
            >
                {l10n.t('Save')}
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
                aria-label={l10n.t('Duplicate')}
                icon={<TabDesktopMultipleRegular />}
                onClick={() => void dispatcher.duplicateTab(state.queryValue)}
                disabled={!state.isConnected}
            >
                {l10n.t('Duplicate')}
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
    const Component = props.type === 'button' ? ToolbarButton : MenuItem;

    return (
        <Menu>
            <MenuTrigger>
                <Component
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    ref={ref}
                    aria-label={l10n.t('Learn more')}
                    icon={<LibraryRegular />}
                >
                    {l10n.t('Learn')}
                </Component>
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
                                    onClick={() => dispatcher.insertText(sample)}
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

const ProvideFeedbackButton = forwardRef((props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement>) => {
    const dispatcher = useQueryEditorDispatcher();

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
                        <MenuItem icon={<CommentCheckmarkRegular />} onClick={() => void dispatcher.provideFeedback()}>
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

const ConnectionButton = forwardRef((props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLDivElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const restoreFocusTargetAttribute = useRestoreFocusTarget();
    const [connectionList, setConnectionList] = useState(state.connectionList);
    const [checkedValues, setCheckedValues] = useState<Record<string, string[]>>({ databaseId: [], collectionId: [] });
    const [selectedOptions, setSelectedOptions] = useState<string[]>([]);

    const currentValue = useMemo(() => {
        return state.dbName && state.collectionName ? `${state.dbName}/${state.collectionName}` : '';
    }, [state.dbName, state.collectionName]);

    useEffect(() => {
        setSelectedOptions([`${state.dbName}/${state.collectionName}`]);
        setCheckedValues({ databaseId: [state.dbName], collectionId: [state.collectionName] });
    }, [state.dbName, state.collectionName]);

    useEffect(() => {
        setConnectionList(state.connectionList);
    }, [state.connectionList]);

    const onOpenChange = useCallback(
        (_e: never, data: { open: boolean }) => {
            if (data.open) {
                void dispatcher.getConnections();
            }
        },
        [dispatcher],
    );

    const onSetConnection = useCallback(
        (databaseId: string, collectionId: string) => {
            void dispatcher.setConnection(databaseId, collectionId);
        },
        [dispatcher],
    );

    const onOptionSelect = useCallback(
        (_event: SelectionEvents, data: OptionOnSelectData) => {
            const selected = data.optionValue;
            if (selected) {
                const [databaseId, collectionId] = selected.split('/');
                void onSetConnection(databaseId, collectionId);
            }
        },
        [dispatcher],
    );

    if (props.type === 'button') {
        return (
            <div ref={ref} style={{ paddingLeft: '8px' }}>
                <Dropdown
                    style={{ minWidth: '100px', maxWidth: '300px' }}
                    aria-label={l10n.t('Connect to…')}
                    placeholder={l10n.t('Connect to…')}
                    value={currentValue}
                    selectedOptions={selectedOptions}
                    onOptionSelect={onOptionSelect}
                    onOpenChange={onOpenChange}
                    {...restoreFocusTargetAttribute}
                >
                    {state.isConnected && !connectionList && (
                        <OptionGroup label={state.dbName}>
                            <Option value={currentValue} text={currentValue}>
                                {state.collectionName}
                            </Option>
                        </OptionGroup>
                    )}
                    {!connectionList && <Option aria-label={l10n.t('Loading…')}>{l10n.t('Loading…')}</Option>}
                    {connectionList && Object.entries(connectionList).length === 0 && (
                        <Option disabled aria-label={l10n.t('No connections')}>
                            {l10n.t('No connections')}
                        </Option>
                    )}
                    {connectionList &&
                        Object.entries(connectionList).map(([databaseId, collections]) => (
                            <OptionGroup key={databaseId} label={databaseId}>
                                {collections.length === 0 && <Option disabled>{l10n.t('No collections')}</Option>}
                                {collections.map((collectionId) => (
                                    <Option
                                        key={collectionId}
                                        value={`${databaseId}/${collectionId}`}
                                        text={`${databaseId}/${collectionId}`}
                                    >
                                        {collectionId}
                                    </Option>
                                ))}
                            </OptionGroup>
                        ))}
                </Dropdown>
            </div>
        );
    }

    return (
        <Menu hasCheckmarks={true} onOpenChange={onOpenChange} checkedValues={checkedValues}>
            <MenuTrigger>
                <MenuItem aria-label={l10n.t('Connect to…')} icon={<DatabasePlugConnectedRegular />}>
                    {l10n.t('Connect to…')}
                </MenuItem>
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    {!connectionList && <MenuItem>{l10n.t('Loading…')}</MenuItem>}
                    {connectionList && Object.entries(connectionList).length === 0 && (
                        <MenuItem disabled>{l10n.t('No connections')}</MenuItem>
                    )}
                    {connectionList &&
                        Object.entries(connectionList).map(([databaseId, collections]) => (
                            <Menu hasCheckmarks={true} checkedValues={checkedValues}>
                                <MenuTrigger disableButtonEnhancement>
                                    <MenuSplitGroup>
                                        <MenuItemCheckbox
                                            key={databaseId}
                                            //icon={databaseId === state.dbName ? <Checkmark16Regular /> : undefined}
                                            name={'databaseId'}
                                            value={databaseId}
                                            submenuIndicator={<ChevronRightIcon />}
                                        >
                                            {databaseId}
                                        </MenuItemCheckbox>
                                        <MenuTrigger disableButtonEnhancement>
                                            <MenuItem aria-label="Open collection list" />
                                        </MenuTrigger>
                                    </MenuSplitGroup>
                                </MenuTrigger>
                                <MenuPopover>
                                    <MenuList>
                                        {collections.length === 0 && (
                                            <MenuItem disabled>{l10n.t('No collections')}</MenuItem>
                                        )}
                                        {collections.map((collectionId) => (
                                            <MenuItemCheckbox
                                                key={collectionId}
                                                name={'collectionId'}
                                                value={collectionId}
                                                onClick={() => void onSetConnection(databaseId, collectionId)}
                                            >
                                                {collectionId}
                                            </MenuItemCheckbox>
                                        ))}
                                    </MenuList>
                                </MenuPopover>
                            </Menu>
                        ))}
                </MenuList>
            </MenuPopover>
        </Menu>
    );
});

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
                    {useQueryEditorState().isSurveyCandidate && (
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
