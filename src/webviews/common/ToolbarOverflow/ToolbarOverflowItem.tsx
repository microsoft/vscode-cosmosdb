/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Ref } from 'react';

export type ToolbarOverflowItemProps<T extends HTMLElement = HTMLElement> = {
    type: 'button' | 'menuitem';
    ref?: Ref<T>;
};
