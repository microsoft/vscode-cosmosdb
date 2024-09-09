//import Editor, { loader } from '@monaco-editor/react';
// eslint-disable-next-line import/no-internal-modules
//import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { Textarea } from '@fluentui/react-components';
import * as React from 'react';

interface Props {
    value: string;
}

export const DataViewPanelJSON = ({ value }: Props): React.JSX.Element => {
    React.useEffect(() => {
        console.log('JSON View has mounted');

        return () => {
            console.log('JSON View will unmount');
        };
    }, []); // Empty dependency array means this runs only once, like componentDidMount

    return (
        // <Editor
        //     height={'100%'}
        //     width={'100%'}
        //     language="json"
        //     value={value}
        // />
        <Textarea
            style={{ height: '80%', width: '80%' }}
            textarea={{ style: { maxHeight: 'unset' } }}
            value={value}
        />
    );
};
