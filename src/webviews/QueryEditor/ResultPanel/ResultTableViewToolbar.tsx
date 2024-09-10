import { makeStyles, Toolbar, ToolbarDivider, ToolbarRadioButton, type ToolbarProps } from '@fluentui/react-components';
import { EditRegular, EyeRegular } from '@fluentui/react-icons';
import {
    useQueryEditorDispatcher,
    useQueryEditorState,
    type EditMode,
    type TableViewMode,
} from '../QueryEditorContext';

const useStyles = makeStyles({
    viewModeButton: {
        maxWidth: '40px',
        minWidth: '40px',
    },
    editModeButton: {
        maxWidth: '60px',
        minWidth: '60px',
    },
    toolbar: {
        padding: '0 0px',
    },
});

const ToolbarDividerTransparent = () => {
    return <div style={{ padding: '18px' }} />;
};

export const ResultTableViewToolbar = () => {
    const styles = useStyles();

    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const checkedValues = {
        tableViewMode: [state.tableViewMode],
        editMode: [state.editMode],
    };

    const onCheckedValueChange: ToolbarProps['onCheckedValueChange'] = (_event, { name, checkedItems }) => {
        if (name === 'tableViewMode') {
            dispatcher.setTableViewMode(checkedItems[0] as TableViewMode);
        } else if (name === 'editMode') {
            dispatcher.setEditMode(checkedItems[0] as EditMode);
        }
    };

    return (
        <Toolbar
            aria-label="Table view toolbar"
            size="small"
            checkedValues={checkedValues}
            className={styles.toolbar}
            onCheckedValueChange={onCheckedValueChange}
        >
            <ToolbarRadioButton
                aria-label="Tree view"
                name={'tableViewMode'}
                value={'Tree'}
                appearance={'transparent'}
                className={styles.viewModeButton}
            >
                Tree
            </ToolbarRadioButton>

            <ToolbarDivider />

            <ToolbarRadioButton
                aria-label="JSON view"
                name={'tableViewMode'}
                value={'JSON'}
                appearance={'transparent'}
                className={styles.viewModeButton}
            >
                JSON
            </ToolbarRadioButton>

            <ToolbarDivider />

            <ToolbarRadioButton
                aria-label="Table view"
                name={'tableViewMode'}
                value={'Table'}
                appearance={'transparent'}
                className={styles.viewModeButton}
            >
                Table
            </ToolbarRadioButton>

            <ToolbarDividerTransparent />

            <ToolbarRadioButton
                aria-label="View mode"
                icon={<EyeRegular />}
                name={'editMode'}
                value={'View'}
                appearance={'transparent'}
                className={styles.editModeButton}
            >
                View
            </ToolbarRadioButton>

            <ToolbarDivider />

            <ToolbarRadioButton
                aria-label="Edit mode"
                icon={<EditRegular />}
                name={'editMode'}
                value={'Edit'}
                appearance={'transparent'}
                className={styles.editModeButton}
                disabled={true}
            >
                Edit
            </ToolbarRadioButton>
        </Toolbar>
    );
};
