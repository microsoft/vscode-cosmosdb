/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { accountOverviewRouter } from '../trpc';
import { accountInventoryProcedures } from './accountOverview/accountInventoryRouter';
import { actionsProcedures } from './accountOverview/actionsRouter';
import { alertsRecommendationsProcedures } from './accountOverview/alertsRecommendationsRouter';
import { derivedAdvisoriesProcedures } from './accountOverview/derivedAdvisoriesRouter';
import { inventoryMetricsProcedures } from './accountOverview/inventoryMetricsRouter';
import { metricSeriesProcedures } from './accountOverview/metricSeriesRouter';
import { partitionHealthProcedures } from './accountOverview/partitionHealthRouter';

// ─── Account Overview Router ────────────────────────────────────────────────
//
// The router is split by dashboard zone under `./accountOverview/`: each zone
// owns a thin procedure map (data preparation + service call) plus its pure
// service module. This file merges those zone procedure maps into the single
// flat tRPC router the webview client consumes (`accountOverview.getMetricSeries`,
// …). Keep the paths flat — the webview binds to them by name.

// Re-exported for `src/webviews/api/types.ts`, which imports the static inventory
// row shape from this module.
export type { InventoryContainerRow, ThroughputMode } from '../../accountOverview/services/inventory';

export const accountOverviewRouterDef = accountOverviewRouter({
    ...accountInventoryProcedures,
    ...metricSeriesProcedures,
    ...inventoryMetricsProcedures,
    ...partitionHealthProcedures,
    ...alertsRecommendationsProcedures,
    ...derivedAdvisoriesProcedures,
    ...actionsProcedures,
});
