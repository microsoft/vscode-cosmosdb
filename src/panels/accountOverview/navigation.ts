/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { METRIC_KEYS } from './metrics/contracts';

export const ACCOUNT_OVERVIEW_TARGETS = ['overview', ...METRIC_KEYS, 'advisories'] as const;
export type AccountOverviewTarget = (typeof ACCOUNT_OVERVIEW_TARGETS)[number];

export interface AccountOverviewNavigation {
    readonly type: 'navigate';
    readonly target: AccountOverviewTarget;
    readonly revision: number;
}

export function isAccountOverviewTarget(value: unknown): value is AccountOverviewTarget {
    return typeof value === 'string' && ACCOUNT_OVERVIEW_TARGETS.some((target) => target === value);
}
