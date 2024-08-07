// eslint-disable-next-line import/no-internal-modules
import { JSX } from 'react';
import './collectionView.scss';
import './my-styles.scss';

import { Avatar, Badge, Button, Caption2, Checkbox, Dropdown, Input, makeStyles, Menu, MenuButton, MenuItemCheckbox, MenuList, MenuPopover, MenuTrigger, Option, Radio, RadioGroup, shorthands, Slider, Switch, Tab, TabList, tokens, Toolbar, ToolbarButton, ToolbarDivider, Tooltip, useId } from '@fluentui/react-components';
import { ArrowClockwiseFilled, ArrowLeftFilled, ArrowPreviousFilled, ArrowRightFilled, bundleIcon, CalendarLtrFilled, CalendarLtrRegular, ChevronRightRegular, ClipboardPasteFilled, ClipboardPasteRegular, CutFilled, CutRegular, DocumentAddRegular, DocumentArrowDownRegular, DocumentDismissRegular, DocumentEditRegular, EditFilled, EditRegular, MeetNowFilled, MeetNowRegular, PlayRegular, SearchFilled, SearchRegular } from "@fluentui/react-icons";


const useStyles = makeStyles({
    root: {
        display: "grid",
        gridTemplateRows: "50vh 50vh"
    },
    row: {
        height: "50vh",
        display: "grid",
        alignItems: "start",
        justifyContent: "center",
        gridTemplateColumns: "repeat(3, 1fr)",
        gridTemplateRows: "auto",
        gridColumnGap: tokens.spacingHorizontalXXXL
    },
    col2: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        ...shorthands.gap(tokens.spacingVerticalL),
    },
    col3: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: 'repeat(4, auto)',
        gridRowGap: tokens.spacingVerticalS,
        gridColumnGap: tokens.spacingHorizontalS,
        justifyContent: 'center',
        alignItems: 'center',
    },
    twoCol: {
        gridColumnStart: 1,
        gridColumnEnd: 3,
    },
    controls: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
    },
    icons: {
        display: 'grid',
        gridTemplateColumns: 'auto auto',
        gridTemplateRows: 'auto auto',
        gridRowGap: tokens.spacingVerticalS,
        gridColumnGap: tokens.spacingHorizontalS,
        justifyContent: 'center',
    },
    avatar: {
        display: 'flex',
        ...shorthands.gap(tokens.spacingVerticalL),
    },
    avatarText: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'left',
    },
});



export const Column1 = (): JSX.Element => {
    const styles = useStyles();
    return (
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        <div>
            <div className={styles.avatar}>
                <Avatar
                    color="brand"
                    initials="CE"
                    badge={{
                        status: 'available',
                        'aria-label': 'available',
                    }}
                />
                <div className={styles.avatarText}>
                    Cameron Evans
                    <Caption2>Senior Researcher at Contoso</Caption2>
                </div>
            </div>
        </div >
    );
};

export const DemoMenu = (): JSX.Element => {
    const CutIcon = bundleIcon(CutFilled, CutRegular);
    const PasteIcon = bundleIcon(ClipboardPasteFilled, ClipboardPasteRegular);
    const EditIcon = bundleIcon(EditFilled, EditRegular);
    return (
        <Menu>
            <MenuTrigger disableButtonEnhancement>
                <MenuButton>Select </MenuButton>
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    <MenuItemCheckbox icon={<CutIcon />} name="edit" value="cut">
                        Cut
                    </MenuItemCheckbox>
                    <MenuItemCheckbox icon={<PasteIcon />} name="edit" value="paste">
                        Paste
                    </MenuItemCheckbox>
                    <MenuItemCheckbox icon={<EditIcon />} name="edit" value="edit">
                        Edit
                    </MenuItemCheckbox>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};

export const Column2 = (): JSX.Element => {
    const styles = useStyles();
    const dropdownId = useId('dropdown-default');
    return (
        <div className={styles.col2}>
            <TabList defaultSelectedValue="tab1">
                <Tab value="tab1">Home</Tab>
                <Tab value="tab2">Pages</Tab>
                <Tab value="tab3">Documents</Tab>
            </TabList>
            <Input
                placeholder="Find"
                contentAfter={<Button aria-label="Find" appearance="transparent" icon={<SearchRegular />} size="small" />}
            />
            <Dropdown aria-labelledby={dropdownId} placeholder="Select" inlinePopup>
                <Option value="Action 1">Action 1</Option>
                <Option value="Action 2">Action 2 </Option>
                <Option value="Action 3">Action 3</Option>
            </Dropdown>
        </div>
    );
};

export const DemoIcons = (): JSX.Element => {
    const styles = useStyles();
    const MeetNowIcon = bundleIcon(MeetNowFilled, MeetNowRegular);
    const CalendarLtrIcon = bundleIcon(CalendarLtrFilled, CalendarLtrRegular);
    return (
        <div className={styles.icons}>
            <Badge size="medium" appearance="filled" icon={<CalendarLtrIcon />} />
            <Badge size="medium" appearance="ghost" icon={<CalendarLtrIcon />} />
            <Badge size="medium" appearance="outline" icon={<MeetNowIcon />} />
            <Badge size="medium" appearance="tint" icon={<MeetNowIcon />} />
        </div>
    );
};

export const Column3 = (): JSX.Element => {
    const styles = useStyles();
    return (
        <div className={styles.col3}>
            <Button appearance="primary">Sign Up</Button>
            <Button
                appearance="transparent"
                icon={<ChevronRightRegular />}
                iconPosition="after"
            >
                Learn More
            </Button>
            <Slider className={styles.twoCol} defaultValue={50} />
            <DemoIcons />
            <div className={styles.controls}>
                <Switch defaultChecked={true} label="On" />
                <Switch label="Off" />
            </div>
            <div className={styles.controls}>
                <Checkbox defaultChecked={true} label="Option 1" />
                <Checkbox label="Option 2" />
            </div>
            <div className={styles.controls}>
                <RadioGroup>
                    <Radio defaultChecked={true} label="Option 1" />
                    <Radio label="Option 2" />
                </RadioGroup>
            </div>
        </div>
    );
};


export const CollectionView = (): JSX.Element => {
    const styles = useStyles();


    return (
        <div className='webview'>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: '10px' }}>
                    <Input contentBefore={<SearchFilled />} style={{ flexGrow: 1 }} />
                    <Button icon={<PlayRegular />} appearance="primary" style={{ flexShrink: 0 }}>Run Find Query</Button>
                </div>
                <div className='row-separator'></div>
                <div className='toolbar'>
                    <div style={{
                        display: 'flex',
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        gap: '10px'
                    }}>
                        <Toolbar aria-label="with Popover" size="small">

                            <Tooltip
                                content="Reload query results"
                                relationship="description"
                                withArrow
                            >
                                <ToolbarButton
                                    aria-label="Refresh"
                                    icon={< ArrowClockwiseFilled />}
                                />
                            </Tooltip>

                            <ToolbarDivider />

                            <Tooltip
                                content="Go to first page"
                                relationship="description"
                                withArrow
                            >
                                <ToolbarButton
                                    aria-label="Go to start"
                                    icon={< ArrowPreviousFilled />}
                                />
                            </Tooltip>

                            <Tooltip
                                content="Go to previous page"
                                relationship="description"
                                withArrow
                            >
                                <ToolbarButton
                                    aria-label="Go to previous page"
                                    icon={< ArrowLeftFilled />}
                                />
                            </Tooltip>

                            <Tooltip
                                content="Go to next page"
                                relationship="description"
                                withArrow
                            >
                                <ToolbarButton
                                    aria-label="Go to next page"
                                    icon={< ArrowRightFilled />}
                                />
                            </Tooltip>

                            <Tooltip
                                content="Change page size"
                                relationship="description"
                                withArrow
                            >
                                <Dropdown
                                    style={{ minWidth: '100px' }}
                                    defaultValue="50"
                                    defaultSelectedOptions={["50"]}
                                >
                                    <Option key="10">
                                        10
                                    </Option>
                                    <Option key="10">
                                        50
                                    </Option>
                                    <Option key="100">
                                        100
                                    </Option>
                                    <Option key="500">
                                        500
                                    </Option>
                                </Dropdown>
                            </Tooltip>



                        </Toolbar>




                        <Toolbar aria-label="with Popover" size="small">

                            <ToolbarButton
                                aria-label="Add new document"
                                icon={< DocumentAddRegular />}
                            />

                            <ToolbarButton
                                aria-label="View selected document"
                                icon={< DocumentArrowDownRegular />}
                            />

                            <ToolbarButton
                                aria-label="Edit selected document"
                                icon={< DocumentEditRegular />}
                            />

                            <ToolbarButton
                                aria-label="Delete selected document"
                                icon={< DocumentDismissRegular />}
                            />


                        </Toolbar>

                        <Dropdown style={{ minWidth: '150px' }}
                            defaultValue="Table View"
                            defaultSelectedOptions={["table"]}
                        >
                            <Option key="table">
                                Table View
                            </Option>
                            <Option key="tree">
                                Tree View
                            </Option>
                            <Option key="json">
                                JSON View
                            </Option>
                        </Dropdown>

                    </div>
                </div>
            </div >

            <div style={{ display: 'flex', marginTop: 10 }}>
                <div><br /><br /><br /><br /><br /></div>
            </div>


            <div className={styles.root}>
                <div className={styles.row}>
                    <Column1 />
                    <Column2 />
                    <Column3 />
                </div>
            </div>


        </div >


    );
};
