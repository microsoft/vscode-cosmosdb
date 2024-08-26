import { Textarea } from '@fluentui/react-components';
import * as React from 'react';

export const DataViewPanelJSON = ({ value }): React.JSX.Element => {
    React.useEffect(() => {
        // This runs after the component has mounted
        console.log('Component has mounted');

        // Optional cleanup function (similar to componentWillUnmount)
        return () => {
            console.log('Component will unmount');
        };
    }, []); // Empty dependency array means this runs only once, like componentDidMount

    return (
        <Textarea
            style={{ height: '100%', width: '100%' }}
            textarea={{ style: { maxHeight: 'unset' } }}
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            value={value}
        />
    );
};
