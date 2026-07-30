/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Proactive, engagement-gated recommendation to install the Azure Cosmos DB Shell.
 *
 * Unlike the reactive install prompt (which only fires when the user explicitly runs
 * "Launch Cosmos DB Shell"), this surface suggests the Shell to users who are actively
 * working with Cosmos DB resources but have never launched it. It is intentionally
 * non-intrusive: a single non-modal notification, rate-limited per session, capped over
 * the lifetime of the install, snooze-able for a cool-down period, and permanently
 * dismissible. It never appears when the Shell is already installed.
 *
 * The primary action funnels into the existing `cosmosDB.launchCosmosDBShell` command,
 * which owns the actual install/detect/launch pipeline — this module only decides *whether*
 * and *when* to recommend, never how to install.
 */
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { SettingsService } from '../../services/SettingsService';
import {
    COMMAND_LAUNCH_COSMOS_DB_SHELL,
    RECOMMENDATION_STATE_IMPRESSION_COUNT,
    RECOMMENDATION_STATE_LATER_UNTIL,
    RECOMMENDATION_STATE_SUPPRESSED,
    SETTING_RECOMMENDATION_ENABLED,
} from '../constants';
import { isCosmosDBShellInstalled } from '../shellSupportCache';

/** Bounded engagement signals accepted by recommendation telemetry. */
export type ShellRecommendationTrigger = 'openDocument' | 'runQuery';

/** Gating configuration for the recommendation. Centralized so behavior is easy to tune. */
const RecommendationConfig = {
    /** Qualifying Cosmos DB actions required within a session before the prompt is eligible. */
    MIN_ACTIONS_BEFORE_PROMPT: 2,
    /** Maximum lifetime impressions before the recommendation auto-suppresses (unless acted upon). */
    LIFETIME_IMPRESSION_CAP: 2,
    /** Days to snooze the recommendation after the user chooses "Later". */
    LATER_COOLDOWN_DAYS: 7,
    /** Official, verifiable docs surface opened by "Learn More". */
    LEARN_MORE_URL: 'https://www.nuget.org/packages/CosmosDBShell',
};

/** In-memory, per-session state. Persistent gating state lives in `ext.context.globalState`. */
class RecommendationState {
    public actionCount = 0;
    public wasShownInSession = false;
}

const recommendationState = new RecommendationState();

/** Whether the feature is enabled (respects VS Code settings policy for central admin control). */
function isRecommendationEnabled(): boolean {
    return SettingsService.getSetting<boolean>(SETTING_RECOMMENDATION_ENABLED) ?? true;
}

/** Whether the user permanently opted out via "Don't show again". */
function isSuppressed(): boolean {
    return ext.context.globalState.get<boolean>(RECOMMENDATION_STATE_SUPPRESSED, false);
}

/** Whether the recommendation is currently snoozed following a "Later" dismissal. */
function isInLaterCooldown(): boolean {
    const laterUntil = ext.context.globalState.get<string>(RECOMMENDATION_STATE_LATER_UNTIL);
    if (!laterUntil) {
        return false;
    }
    const until = new Date(laterUntil).getTime();
    return Number.isFinite(until) && Date.now() < until;
}

/**
 * Records a qualifying Cosmos DB engagement signal and, once enough signals have accrued and
 * all gating conditions pass, shows the recommendation notification (at most once per session).
 *
 * Cheap pre-checks run before any telemetry so browsing users who will never be prompted don't
 * generate recommendation events on every action.
 *
 * @param triggerAction Stable identifier of the action that produced the signal (no PII).
 */
export async function recordCosmosShellEngagementAndMaybeRecommend(
    triggerAction: ShellRecommendationTrigger,
): Promise<void> {
    if (recommendationState.wasShownInSession) {
        return;
    }
    if (isCosmosDBShellInstalled()) {
        return;
    }
    if (!isRecommendationEnabled() || isSuppressed() || isInLaterCooldown()) {
        return;
    }

    recommendationState.actionCount++;
    if (recommendationState.actionCount < RecommendationConfig.MIN_ACTIONS_BEFORE_PROMPT) {
        return;
    }

    const impressionCount = ext.context.globalState.get<number>(RECOMMENDATION_STATE_IMPRESSION_COUNT, 0);
    if (impressionCount >= RecommendationConfig.LIFETIME_IMPRESSION_CAP) {
        recommendationState.wasShownInSession = true;
        await ext.context.globalState.update(RECOMMENDATION_STATE_SUPPRESSED, true);
        return;
    }

    // Claim the prompt synchronously before any asynchronous work so concurrent engagement
    // signals cannot display duplicate notifications in the same extension session.
    recommendationState.wasShownInSession = true;
    await showShellRecommendation(triggerAction);
}

/**
 * Shows the non-modal recommendation notification and applies the user's choice to the
 * persistent gating state. Emits `recommendation.shown` when displayed and
 * `recommendation.clicked` for the resulting selection.
 */
async function showShellRecommendation(triggerAction: ShellRecommendationTrigger): Promise<void> {
    await callWithTelemetryAndErrorHandling(
        'cosmosDB.cosmosDBShell.recommendation.shown',
        async (context: IActionContext) => {
            context.errorHandling.suppressDisplay = true;
            context.errorHandling.rethrow = false;

            const impressionCount = ext.context.globalState.get<number>(RECOMMENDATION_STATE_IMPRESSION_COUNT, 0);
            context.telemetry.properties.triggerAction = triggerAction;
            context.telemetry.measurements.impressionCount = impressionCount + 1;

            // Count this impression before awaiting the click.
            await ext.context.globalState.update(RECOMMENDATION_STATE_IMPRESSION_COUNT, impressionCount + 1);

            const installLaunch = l10n.t('Install & Launch');
            const learnMore = l10n.t('Learn More');
            const later = l10n.t('Later');
            const dontShowAgain = l10n.t("Don't show again");

            const selection = await vscode.window.showInformationMessage(
                l10n.t(
                    'Work with Cosmos DB in the terminal? The Azure Cosmos DB Shell lets you query, script, and navigate your databases like a filesystem.',
                ),
                installLaunch,
                learnMore,
                later,
                dontShowAgain,
            );

            if (selection !== undefined) {
                const outcome =
                    selection === installLaunch
                        ? 'installLaunch'
                        : selection === learnMore
                          ? 'learnMore'
                          : selection === later
                            ? 'later'
                            : 'dontShowAgain';
                reportRecommendationClicked(outcome);
                // The lifetime cap is intended for ignored impressions. An explicit action shows
                // interest, so restart the cap (the install and permanent-opt-out actions will
                // independently prevent future recommendations).
                await ext.context.globalState.update(RECOMMENDATION_STATE_IMPRESSION_COUNT, 0);
            }

            switch (selection) {
                case installLaunch:
                    // Hand off to the existing install/detect/launch pipeline.
                    await vscode.commands.executeCommand(COMMAND_LAUNCH_COSMOS_DB_SHELL);
                    break;
                case learnMore:
                    await vscode.env.openExternal(vscode.Uri.parse(RecommendationConfig.LEARN_MORE_URL));
                    break;
                case later: {
                    const until = new Date();
                    until.setDate(until.getDate() + RecommendationConfig.LATER_COOLDOWN_DAYS);
                    await ext.context.globalState.update(RECOMMENDATION_STATE_LATER_UNTIL, until.toISOString());
                    break;
                }
                case dontShowAgain:
                    await ext.context.globalState.update(RECOMMENDATION_STATE_SUPPRESSED, true);
                    break;
                default:
                    break;
            }
        },
    );
}

/**
 * Fires the `recommendation.clicked` funnel event with a bounded action variant.
 * No file contents, paths, or names are emitted.
 */
function reportRecommendationClicked(selection: 'installLaunch' | 'learnMore' | 'later' | 'dontShowAgain'): void {
    void callWithTelemetryAndErrorHandling(
        'cosmosDB.cosmosDBShell.recommendation.clicked',
        (context: IActionContext) => {
            context.errorHandling.suppressDisplay = true;
            context.errorHandling.rethrow = false;
            context.telemetry.properties.selection = selection;
        },
    );
}

/** Internal state access used only by unit tests. */
export function getShellRecommendationTestState(): RecommendationState | undefined {
    return process.env.NODE_ENV === 'test' ? recommendationState : undefined;
}

/** Internal configuration access used only by unit tests. */
export function getShellRecommendationTestConfig(): typeof RecommendationConfig | undefined {
    return process.env.NODE_ENV === 'test' ? RecommendationConfig : undefined;
}
