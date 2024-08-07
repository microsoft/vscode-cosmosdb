import { type JSX } from 'react';
import './fluentUiDemo.scss';

import {
    Avatar,
    Badge,
    Button,
    Caption2,
    Checkbox,
    Dropdown,
    FluentProvider,
    Input,
    makeStyles,
    Menu,
    MenuButton,
    MenuItemCheckbox,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Option,
    Radio,
    RadioGroup,
    shorthands,
    Slider,
    Switch,
    Tab,
    TabList,
    tokens,
    useId,
} from '@fluentui/react-components';
import {
    bundleIcon,
    CalendarLtrFilled,
    CalendarLtrRegular,
    ChevronRightRegular,
    ClipboardPasteFilled,
    ClipboardPasteRegular,
    CutFilled,
    CutRegular,
    EditFilled,
    EditRegular,
    MeetNowFilled,
    MeetNowRegular,
    SearchRegular,
} from '@fluentui/react-icons';
import { adaptiveTheme } from '../themeGenerator';

// this is the 'fluent ui' way of doing this, left in here so that the demo code is executed,
// work with scss if possible for easier management
const useStyles = makeStyles({
    root: {
        display: 'grid',
        gridTemplateRows: '50vh 50vh',
    },
    row: {
        height: '50vh',
        display: 'grid',
        alignItems: 'start',
        justifyContent: 'center',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'auto',
        gridColumnGap: tokens.spacingHorizontalXXXL,
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
        </div>
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
                contentAfter={
                    <Button aria-label="Find" appearance="transparent" icon={<SearchRegular />} size="small" />
                }
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
            <Button appearance="transparent" icon={<ChevronRightRegular />} iconPosition="after">
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

export const FluentUiDemo = (): JSX.Element => {
    const styles = useStyles();

    return (
        <FluentProvider theme={adaptiveTheme}>
            <div className="webview">
                <div className={styles.root}>
                    <div className={styles.row}>
                        <Column1 />
                        <Column2 />
                        <Column3 />
                    </div>
                </div>
            </div>
        </FluentProvider>
    );
};
