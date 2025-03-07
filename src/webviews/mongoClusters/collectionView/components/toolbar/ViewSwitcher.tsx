/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dropdown, Option } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useContext, type JSX } from 'react';
import { CollectionViewContext } from '../../collectionViewContext';

const defaultView: string = 'Table View';

export function ViewSwitcher({ onViewChanged }): JSX.Element {
    const [currentContext] = useContext(CollectionViewContext);

    return (
        <Dropdown
            disabled={currentContext.isLoading}
            style={{ minWidth: '120px', maxWidth: '120px' }}
            defaultValue={defaultView}
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
            onOptionSelect={(_, data) => onViewChanged(data.optionValue)}
        >
            <Option key="table">{l10n.t('Table View')}</Option>
            <Option key="tree">{l10n.t('Tree View')}</Option>
            <Option key="json">{l10n.t('JSON View')}</Option>
        </Dropdown>
    );
}
