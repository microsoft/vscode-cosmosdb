import { makeStyles } from '@fluentui/react-components';
import { QueryMonaco } from './QueryMonaco';
import { QueryToolbar } from './QueryToolbar';

const useClasses = makeStyles({
    toolbarContainer: {
        marginBottom: '10px',
    },
    monacoContainer: {
        marginTop: '10px',
        width: '100%',
        height: 'calc(100% - 50px)',
    },
});

export const QueryPanel = () => {
    const classes = useClasses();

    return (
        <>
            <div className={classes.toolbarContainer}>
                <QueryToolbar />
            </div>
            <div className={classes.monacoContainer}>
                <QueryMonaco />
            </div>
        </>
    );
};
