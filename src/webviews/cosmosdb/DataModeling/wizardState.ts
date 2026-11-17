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
    icon: string;
    title: string;
    description: string;
}

function roleOption(value: PropertyRole, icon: string, title: string, description: string): PropertyRoleOption {
    return { value, label: `${icon} ${title}`, icon, title, description };
}

export function getRoleOptions(): PropertyRoleOption[] {
    return [
        roleOption(
            'key',
            '🔑',
            l10n.t('Unique / business key'),
            l10n.t('Choose for a field that identifies a document or business entity, such as an order ID.'),
        ),
        roleOption(
            'filter',
            '🔎',
            l10n.t('Query filter'),
            l10n.t('Choose for a field used to filter queries, such as a category or status.'),
        ),
        roleOption(
            'payload',
            '📄',
            l10n.t('Payload / other'),
            l10n.t('Choose for a field stored in the document but not used to identify it or filter queries.'),
        ),
    ];
}
