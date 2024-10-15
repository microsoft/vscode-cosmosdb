/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dropdown, Option } from '@fluentui/react-components';
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
            <Option key="table">Table View</Option>
            <Option key="tree">Tree View</Option>
            <Option key="json">JSON View</Option>
        </Dropdown>
    );
}
