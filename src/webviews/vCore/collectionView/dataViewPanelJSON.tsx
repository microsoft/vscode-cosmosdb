import { Textarea } from '@fluentui/react-components';
import * as React from 'react';

interface Props {
    value: string;
}

export const DataViewPanelJSON = ({ value } : Props ): React.JSX.Element => {
    React.useEffect(() => {
        console.log('JSON View has mounted');

        return () => {
            console.log('JSON View will unmount');
        };
    }, []); // Empty dependency array means this runs only once, like componentDidMount

    return (
        <Textarea
            style={{ height: '100%', width: '100%' }}
            textarea={{ style: { maxHeight: 'unset' } }}
            value={value}
        />
    );
};
