/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type QuickStartTip } from '../../../../utils/quickStart/quickStartTypes';

/**
 * Logical groups Query Editor tips belong to. A group is considered "complete"
 * once every tip in it has been seen.
 *
 * The groups are surfaced at different moments of the staged Quick Start flow:
 *  - ungrouped tips (no `group`) are shown first, as a general intro;
 *  - the `editor` group is shown right after, when the editor opens;
 *  - the `result` group is shown once the user runs their first query (the
 *    result controls it points at only exist after results are loaded).
 */
export const QUERY_EDITOR_TIP_GROUP = 'editor';
export const QUERY_EDITOR_RESULTS_TIP_GROUP = 'result';

/** All groups a Query Editor tip is allowed to belong to. */
export const QUERY_EDITOR_TIP_GROUPS: readonly string[] = [QUERY_EDITOR_TIP_GROUP, QUERY_EDITOR_RESULTS_TIP_GROUP];

/**
 * The order groups are played in during the staged auto-flow and a full manual
 * replay. Ungrouped intro tips (handled separately) come before this list.
 */
export const QUICK_START_GROUP_ORDER: readonly string[] = [QUERY_EDITOR_TIP_GROUP, QUERY_EDITOR_RESULTS_TIP_GROUP];

/**
 * Ordered registry of Quick Start tips shown in the Query Editor.
 *
 * Authoring rules:
 *  - `id` is a stable persistence key. NEVER rename or reuse an id. Adding a new
 *    id is exactly how a tip becomes "new" (and auto-shows) after an update.
 *  - `group` ties the tip to a stage of the flow (see the group constants
 *    above). Omit it for an ungrouped intro tip shown before any group.
 *  - `targetSelector` must match a `data-quickstart="<id>"` attribute rendered
 *    by the corresponding control. Prefer these data attributes over
 *    class/aria selectors, which are brittle and/or localized.
 *  - All user-facing strings go through `l10n.t()` so they can be translated.
 *    A tip is only surfaced when its target element exists, so tips for hidden
 *    controls (e.g. the AI button or the edit-mode item buttons) are safely
 *    skipped.
 *  - Array order is display order within a group; keep each group contiguous.
 */
export function getQueryEditorTips(): QuickStartTip[] {
    return [
        // ── editor group ────────────────────────────────────────────────────
        {
            id: 'run-query',
            group: QUERY_EDITOR_TIP_GROUP,
            title: l10n.t('Run your query'),
            body: l10n.t(
                'Press Run to execute the query in the editor. Use the dropdown to replay a recent query or tune throughput and priority.',
            ),
            targetSelector: '[data-quickstart="run-query"]',
            position: 'below-start',
        },
        {
            id: 'ai-assist',
            group: QUERY_EDITOR_TIP_GROUP,
            title: l10n.t('Build queries with AI'),
            body: l10n.t('Use the AI menu to generate a query from a description or to explain the current query.'),
            targetSelector: '[data-quickstart="ai-assist"]',
            position: 'below',
        },
        {
            id: 'view-schema',
            group: QUERY_EDITOR_TIP_GROUP,
            title: l10n.t('Explore your schema'),
            body: l10n.t('Generate and browse the container schema to discover fields and write queries faster.'),
            targetSelector: '[data-quickstart="view-schema"]',
            position: 'below',
        },
        {
            id: 'provide-feedback',
            group: QUERY_EDITOR_TIP_GROUP,
            title: l10n.t('Share your feedback'),
            body: l10n.t('Tell us what works and what does not — your feedback helps shape the Query Editor.'),
            targetSelector: '[data-quickstart="provide-feedback"]',
            position: 'below',
        },
        {
            id: 'connection',
            group: QUERY_EDITOR_TIP_GROUP,
            title: l10n.t('Pick a container'),
            body: l10n.t('Choose the database and container to run your queries against from this connection picker.'),
            targetSelector: '[data-quickstart="connection"]',
            position: 'below-end',
        },
        {
            id: 'page-size',
            group: QUERY_EDITOR_TIP_GROUP,
            title: l10n.t('Set rows per page'),
            body: l10n.t('Choose how many rows to load per page. Larger pages cost more request units to fetch.'),
            targetSelector: '[data-quickstart="page-size"]',
            position: 'above',
        },

        // ── result group ────────────────────────────────────────────────────
        {
            id: 'result-tabs',
            group: QUERY_EDITOR_RESULTS_TIP_GROUP,
            title: l10n.t('Results and stats'),
            body: l10n.t('Switch between the Result tab and the Stats tab to inspect your data and the query metrics.'),
            targetSelector: '[data-quickstart="result-tabs"]',
            position: 'below-start',
        },
        {
            id: 'new-item',
            group: QUERY_EDITOR_RESULTS_TIP_GROUP,
            title: l10n.t('Add a document'),
            body: l10n.t('Create a brand new document in the container from a separate editor tab.'),
            targetSelector: '[data-quickstart="new-item"]',
            position: 'below',
        },
        {
            id: 'view-item',
            group: QUERY_EDITOR_RESULTS_TIP_GROUP,
            title: l10n.t('View a document'),
            body: l10n.t('Open the selected document in a read-only tab to inspect its full contents.'),
            targetSelector: '[data-quickstart="view-item"]',
            position: 'below',
        },
        {
            id: 'edit-item',
            group: QUERY_EDITOR_RESULTS_TIP_GROUP,
            title: l10n.t('Edit a document'),
            body: l10n.t('Open the selected document in an editable tab to change and save it.'),
            targetSelector: '[data-quickstart="edit-item"]',
            position: 'below',
        },
        {
            id: 'reload-query',
            group: QUERY_EDITOR_RESULTS_TIP_GROUP,
            title: l10n.t('Refresh your results'),
            body: l10n.t('Re-run the current query to pull the latest data without retyping it.'),
            targetSelector: '[data-quickstart="reload-query"]',
            position: 'below-start',
        },
        {
            id: 'pagination',
            group: QUERY_EDITOR_RESULTS_TIP_GROUP,
            title: l10n.t('Page through results'),
            body: l10n.t('Large result sets load one page at a time. Use the paging controls to load more results.'),
            targetSelector: '[data-quickstart="pagination"]',
            position: 'below',
        },
        {
            id: 'export-results',
            group: QUERY_EDITOR_RESULTS_TIP_GROUP,
            title: l10n.t('Export your results'),
            body: l10n.t('Save the current results — or just your selection — to a CSV or JSON file.'),
            targetSelector: '[data-quickstart="export-results"]',
            position: 'below-end',
        },
    ];
}
