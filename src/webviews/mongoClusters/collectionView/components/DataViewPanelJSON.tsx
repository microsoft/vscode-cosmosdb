/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { MonacoEditor } from '../../../MonacoEditor';

interface Props {
    value: string[];
}

const monacoOptions = {
    // autoIndent: 'full',
    // contextmenu: true,
    // fontFamily: 'monospace',
    // fontSize: 13,
    // lineHeight: 24,
    // hideCursorInOverviewRuler: true,
    // matchBrackets: 'always',
    minimap: {
        enabled: true,
    },
    // scrollbar: {
    //   horizontalSliderSize: 4,
    //   verticalSliderSize: 18,
    // },
    // selectOnLineNumbers: true,
    // roundedSelection: false,
    readOnly: true,
    // cursorStyle: 'line',
    // automaticLayout: true,
};

export const DataViewPanelJSON = ({ value }: Props): React.JSX.Element => {
    return <MonacoEditor height={'100%'} width={'100%'} language="json" options={monacoOptions} value={value.join('\n\n')} />;
};
