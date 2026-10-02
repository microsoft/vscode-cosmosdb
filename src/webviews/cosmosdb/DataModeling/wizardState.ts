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
}

export function getRoleOptions(): PropertyRoleOption[] {
    return [
        { value: 'key', label: l10n.t('🔑 Unique / business key') },
        { value: 'filter', label: l10n.t('🔎 Query filter') },
        { value: 'payload', label: l10n.t('📄 Payload / other') },
    ];
}
