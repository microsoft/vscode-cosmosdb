/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { MonacoEditor } from '../../../MonacoEditor';

type ResultTabViewJsonProps = {
    data: string;
};

export const ResultTabViewJson = ({ data }: ResultTabViewJsonProps) => {
    return (
        <MonacoEditor
            height={'100%'}
            width={'100%'}
            defaultLanguage={'json'}
            value={data || l10n.t('No result')}
            options={{ domReadOnly: true, readOnly: true }}
        />
    );
};
