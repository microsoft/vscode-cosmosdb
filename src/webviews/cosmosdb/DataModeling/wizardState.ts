/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * UI option lists for the Data page. State construction and derivation now live in
 * {@link ./dataModel}.
 */

import * as l10n from '@vscode/l10n';
import { type PropertyRole } from './models';

export interface PropertyRoleOption {
    value: PropertyRole;
    label: string;
    description: string;
}

export function getRoleOptions(): PropertyRoleOption[] {
    return [
        {
            value: 'key',
            label: '🔑 ' + l10n.t('Unique / business key'),
            description: l10n.t(
                'Choose for a field that identifies a document or business entity, such as an order ID.',
            ),
        },
        {
            value: 'filter',
            label: '🔎 ' + l10n.t('Query filter'),
            description: l10n.t('Choose for a field used to filter queries, such as a category or status.'),
        },
        {
            value: 'payload',
            label: '📄 ' + l10n.t('Payload / other'),
            description: l10n.t(
                'Choose for a field stored in the document but not used to identify it or filter queries.',
            ),
        },
    ];
}
