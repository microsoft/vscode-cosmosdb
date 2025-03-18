/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import crypto from 'crypto';
import * as semver from 'semver';
import { env, Uri, window } from 'vscode';
import * as nls from 'vscode-nls';
import { ext } from '../extensionVariables';
import { ExperienceKind, type UsageImpact } from './surveyTypes';

// Survey Configuration
const SurveyConfig = {
    urls: {
        NOSQL: 'https://aka.ms/AzureDatabasesSurvey',
        MONGO: 'https://aka.ms/AzureDatabasesSurvey/mongo',
    },
    settings: {
        DEBUG_ALWAYS_PROMPT: false, // Forces survey prompt regardless of conditions
        DISABLE_SURVEY: false, // Completely disables survey functionality
        PROBABILITY: 1, // Probability to become candidate (0-1), Azure Tools uses 0.15
        A_B_TEST_SELECTION: 0.25, // change this value to adjust the candidate selection (e.g. 0.50 for 50% of users)
        PROMPT_ENGLISH_ONLY: false, // Whether to limit survey to English locales
        PROMPT_VERSION_ONLY_ONCE: true, // Only prompt once per major/minor version
        PROMPT_DATE_ONLY_ONCE: true, // Only prompt once per day
        MIN_SESSIONS_BEFORE_PROMPT: 9, // Sessions required before eligible for prompting
        SNOOZE_SESSIONS: 3, // Sessions to skip after "remind me later"
        REARM_AFTER_DAYS: 90, // Days before re-prompting after taking survey
        REARM_OPT_OUT: true, // Whether to re-prompt after opt-out period
    },
    scoring: {
        REQUIRED_SCORE: 100, // Score needed to trigger survey
        MAX_SCORE: 1000, // Maximum score to prevent overcounting
    },
};

class SurveyState {
    public isCandidate: boolean | undefined = undefined;
    public wasPromptedInSession = false;
    public usageScoreByExperience: Record<ExperienceKind, number> = {
        [ExperienceKind.Mongo]: 0,
        [ExperienceKind.NoSQL]: 0,
    };
}

const GLOBAL_STATE_KEY_PREFIX = 'ms-azuretools.vscode-cosmosdb.survey';
//Survey keys for persistent storage
const StateKeys = {
    SESSION_COUNT: `${GLOBAL_STATE_KEY_PREFIX}/sessionCount`,
    LAST_SESSION_DATE: `${GLOBAL_STATE_KEY_PREFIX}/lastSessionDate`,
    SKIP_VERSION: `${GLOBAL_STATE_KEY_PREFIX}/skipVersion`,
    SURVEY_TAKEN_DATE: `${GLOBAL_STATE_KEY_PREFIX}/surveyTaken`,
    OPT_OUT_DATE: `${GLOBAL_STATE_KEY_PREFIX}/surveyOptOut`,
};

const surveyState = new SurveyState();
const localize = nls.loadMessageBundle();

/**
 * Determines whether surveys are disabled globally across the extension.
 *
 * @returns {boolean} True if surveys are disabled globally, false otherwise.
 *
 * @remarks
 * Currently uses the extension's setting but per TODO note, this should
 * be migrated to a global admin constant setting.
 */
export function getIsSurveyDisabledGlobally(): boolean {
    // TODO: This should be a global admin constent setting, not just for the extension,
    // also tests will fail if `true` and need to take the disabled scenario into account
    return SurveyConfig.settings.DISABLE_SURVEY;
}

/**
 * Opens the survey in the default browser, determining the appropriate URL based on user experience
 * @param experience The experience type to open survey for, or undefined to use the highest score experience
 * @param triggerAction Optional action that triggered the survey for telemetry
 */
export function openSurvey(experience: ExperienceKind | undefined, triggerAction?: string): void {
    if (getIsSurveyDisabledGlobally()) {
        return;
    }
    if (experience === undefined) {
        const { highestExperience, fullScore } = calculateScoreMetrics();
        // Use the highest experience only if there's actual usage data,
        // otherwise fall back to NoSQL as default
        experience = fullScore > 0 ? highestExperience[0] : ExperienceKind.NoSQL;
    }

    void callWithTelemetryAndErrorHandling('survey.open', (context: IActionContext) => {
        context.telemetry.properties.isCandidate = (
            surveyState.isCandidate === undefined ? false : surveyState.isCandidate
        ).toString();
        context.telemetry.properties.experience = experience;
        context.telemetry.properties.triggerAction = triggerAction;
        void env.openExternal(
            //NOTE: Customer Voice does not support URL parameters, keeping this comment for reference if we switch to another platform which supports that
            //void env.openExternal(Uri.parse(`${surveyUrl}?o=${encodeURIComponent(process.platform)}&v=${encodeURIComponent(extensionVersion)}&m=${encodeURIComponent(env.machineId)}`));
            Uri.parse(experience === ExperienceKind.Mongo ? SurveyConfig.urls.MONGO : SurveyConfig.urls.NOSQL),
        );
    });
}

/**
 * Increments the usage score for a specific experience type
 * @param experience The experience type to increment score for
 * @param score The amount to increment the score by
 */
export function countExperienceUsageForSurvey(experience: ExperienceKind, score: UsageImpact | number): void {
    if (getIsSurveyDisabledGlobally() || surveyState.wasPromptedInSession) {
        return;
    }
    const newScore = Math.min(
        SurveyConfig.scoring.MAX_SCORE,
        surveyState.usageScoreByExperience[experience] + Math.max(0, score),
    );
    surveyState.usageScoreByExperience[experience] = newScore;
}

/**
 * Increments the usage score and potentially displays the survey prompt if threshold is reached
 * @param experience The experience type to count
 * @param score The amount to increment the score by
 * @param triggerAction Optional action that triggered this function for telemetry
 */
export async function promptAfterActionEventually(
    experience: ExperienceKind,
    score: UsageImpact | number,
    triggerAction?: string,
): Promise<void> {
    if (getIsSurveyDisabledGlobally() || surveyState.wasPromptedInSession) {
        return;
    }

    countExperienceUsageForSurvey(experience, score);

    const { fullScore, highestExperience } = calculateScoreMetrics();

    if (fullScore >= SurveyConfig.scoring.REQUIRED_SCORE) {
        await surveyPromptIfCandidate(highestExperience[0], triggerAction);
    }
}

function calculateScoreMetrics(): {
    fullScore: number;
    highestExperience: [ExperienceKind, number];
} {
    return (Object.entries(surveyState.usageScoreByExperience) as [ExperienceKind, number][]).reduce(
        (acc, entry) => {
            acc.fullScore = Math.min(SurveyConfig.scoring.MAX_SCORE, acc.fullScore + entry[1]);

            // Only update the highest experience if:
            // 1. The new score is strictly higher than the current highest, OR
            // 2. The current highest is NoSQL and scores are equal (to preserve NoSQL as default)
            if (
                entry[1] > acc.highestExperience[1] ||
                (entry[0] === ExperienceKind.NoSQL && entry[1] === acc.highestExperience[1])
            ) {
                acc.highestExperience = entry;
            }
            return acc;
        },
        { fullScore: 0, highestExperience: [ExperienceKind.NoSQL, 0] as [ExperienceKind, number] },
    );
}

export async function getIsSurveyCandidate(): Promise<boolean> {
    if (getIsSurveyDisabledGlobally()) {
        return false;
    }
    if (surveyState.isCandidate === undefined) {
        await initSurvey();
    }
    return surveyState.isCandidate ?? false;
}

async function initSurvey(): Promise<void> {
    await callWithTelemetryAndErrorHandling('survey.init', async (context: IActionContext) => {
        if (SurveyConfig.settings.DEBUG_ALWAYS_PROMPT) {
            context.telemetry.properties.isCandidate = (surveyState.isCandidate = true).toString();
            return;
        }

        // Prompt only for English locales
        if (SurveyConfig.settings.PROMPT_ENGLISH_ONLY && env.language !== 'en' && !env.language.startsWith('en-')) {
            context.telemetry.properties.isCandidate = (surveyState.isCandidate = false).toString();
            return;
        }

        // Prompt only once per major/minor version,
        // SKIP_VERSION_KEY will be set to the version that was prompted already and the user either clicked "Don't Ask Again" or opened the survey
        const extensionVersion = (ext.context.extension.packageJSON as { version: string }).version;
        const extensionSemVer = semver.parse(extensionVersion);
        const skipVersion = semver.parse(ext.context.globalState.get(StateKeys.SKIP_VERSION, ''));
        if (SurveyConfig.settings.PROMPT_VERSION_ONLY_ONCE && skipVersion && extensionSemVer) {
            // don't prompt for the same version, major/minor - ignoring patch versions (don't rearm for patch versions)
            if (extensionSemVer.major === skipVersion.major && extensionSemVer.minor === skipVersion.minor) {
                context.telemetry.properties.isCandidate = (surveyState.isCandidate = false).toString();
                return;
            }
        }

        const today = new Date();
        const rearmAfterDate = new Date();
        rearmAfterDate.setDate(today.getDate() - SurveyConfig.settings.REARM_AFTER_DAYS);

        // Skip if Survey has been taken within the last REARM_AFTER_DAYS days
        const surveyTakenDate = new Date(
            ext.context.globalState.get(StateKeys.SURVEY_TAKEN_DATE, new Date(0).toDateString()),
        );
        if (surveyTakenDate.getTime() >= rearmAfterDate.getTime()) {
            context.telemetry.properties.isCandidate = (surveyState.isCandidate = false).toString();
            return;
        }

        // Check if the user has opted out
        const optOutDateString = ext.context.globalState.get(StateKeys.OPT_OUT_DATE, undefined);
        if (optOutDateString) {
            // Skip if opted out within the last REARM_AFTER_DAYS days
            const optOutDate = new Date(optOutDateString);
            if (!SurveyConfig.settings.REARM_OPT_OUT || optOutDate.getTime() >= rearmAfterDate.getTime()) {
                context.telemetry.properties.isCandidate = (surveyState.isCandidate = false).toString();
                return;
            }
        }

        // Prompt only once per day,
        // LAST_SESSION_DATE_KEY will be set to the last date the user was prompted
        const lastSessionDate = new Date(
            ext.context.globalState.get(StateKeys.LAST_SESSION_DATE, new Date(0).toISOString()),
        );
        if (SurveyConfig.settings.PROMPT_DATE_ONLY_ONCE && today.toDateString() === lastSessionDate.toDateString()) {
            context.telemetry.properties.isCandidate = (surveyState.isCandidate = false).toString();
            return;
        }

        // Count sessions and decide if the user is a candidate
        const sessionCount = ext.context.globalState.get(StateKeys.SESSION_COUNT, 0) + 1;
        await ext.context.globalState.update(StateKeys.LAST_SESSION_DATE, today);
        await ext.context.globalState.update(StateKeys.SESSION_COUNT, sessionCount);
        if (sessionCount < SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT) {
            context.telemetry.properties.isCandidate = (surveyState.isCandidate = false).toString();
            return;
        }

        /**
         * At this point, the user is a candidate for the survey, all checks above abourt/return on 'false'.
         * We need to determine if they are part of the A/B test group or not.
         *
         * Deterministic A/B test selection using machine ID hash.
         * Falls back to random selection if the hashing process fails.
         */

        try {
            // Deterministic machine ID selection using MD5 (faster than SHA-256)
            // MD5 is sufficient for non-security random distribution needs
            const buffer = crypto.createHash('md5').update(env.machineId).digest();

            // Read a 32-bit unsigned integer from the buffer directly
            // (Using the first 4 bytes gives a full 32-bit range)
            const hashInt = buffer.readUInt32BE(0);

            // Normalize to a value between 0 and 1
            // 0xffffffff = 4294967295 (max value of a 32-bit unsigned integer)
            const normalized = hashInt / 0xffffffff;

            // Determine if this machine is selected for the survey
            // Lower normalized values = selected
            const acceptedForABTest = normalized < SurveyConfig.settings.A_B_TEST_SELECTION;

            // Record selection result in telemetry
            context.telemetry.properties.acceptedForABTest = acceptedForABTest.toString();
            context.telemetry.properties.normalizedValue = normalized.toFixed(6);

            // Update surveyState.isCandidate based on selection result
            surveyState.isCandidate = acceptedForABTest;
        } catch (error) {
            // Record error message from hashing in telemetry if available
            context.telemetry.properties.abTestError = error instanceof Error ? error.message : String(error);

            // Record that fallback selection was used in telemetry
            context.telemetry.properties.usedFallbackSelection = 'true';

            surveyState.isCandidate = Math.random() < SurveyConfig.settings.PROBABILITY;
        }

        context.telemetry.properties.isCandidate = surveyState.isCandidate.toString();
    });
}

async function surveyPromptIfCandidate(
    experience: ExperienceKind = ExperienceKind.NoSQL,
    triggerAction?: string,
): Promise<void> {
    if (surveyState.wasPromptedInSession) {
        return;
    }
    await callWithTelemetryAndErrorHandling('survey.prompt', async (context: IActionContext) => {
        const isCandidate = await getIsSurveyCandidate();
        context.telemetry.properties.isCandidate = isCandidate.toString();
        context.telemetry.properties.experience = experience;
        context.telemetry.properties.triggerAction = triggerAction;
        context.telemetry.properties.userAsked = 'false'; // this will be set to 'true' later if the user interacts with the prompt
        surveyState.wasPromptedInSession = true; // disarm for the rest of the session
        if (!isCandidate) {
            return;
        }

        const extensionVersion = (ext.context.extension.packageJSON as { version: string }).version;
        const date = new Date().toDateString();

        const take = {
            title: localize('azureResourceGroups.takeSurvey', 'Take Survey'),
            run: async () => {
                context.telemetry.properties.takeShortSurvey = 'true';
                openSurvey(experience, triggerAction);
                await ext.context.globalState.update(StateKeys.SKIP_VERSION, extensionVersion);
                await ext.context.globalState.update(StateKeys.SESSION_COUNT, 0);
                await ext.context.globalState.update(StateKeys.SURVEY_TAKEN_DATE, date);
            },
        };
        const remind = {
            title: localize('azureResourceGroups.remindLater', 'Remind Me Later'),
            run: async () => {
                context.telemetry.properties.remindMeLater = 'true';
                await ext.context.globalState.update(
                    StateKeys.SESSION_COUNT,
                    SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT - SurveyConfig.settings.SNOOZE_SESSIONS,
                );
            },
        };
        const never = {
            title: localize('azureResourceGroups.neverAgain', "Don't Ask Again"),
            isSecondary: true,
            run: async () => {
                context.telemetry.properties.dontShowAgain = 'true';
                await ext.context.globalState.update(StateKeys.SKIP_VERSION, extensionVersion);
                await ext.context.globalState.update(StateKeys.SESSION_COUNT, 0);
                await ext.context.globalState.update(StateKeys.OPT_OUT_DATE, date);
            },
        };

        const button = await window.showInformationMessage(
            localize(
                'azureDatabases.surveyQuestion',
                'Do you mind taking a quick feedback survey about Azure Databases for VS Code?',
            ),
            take,
            remind,
            never,
        );
        context.telemetry.properties.userAsked = 'true';
        await (button || remind).run();
    });
}

/**
 * This section is only for tests
 * Currently we use swc which doesn't support "@internal" alongside with the stripInternal option.
 * So we rely on webpack to set the NODE_ENV to 'test' and return the real states for tests only.
 * Once we can switch to tsc or swc adds this option, we should remove the (process.env.NODE_ENV === 'test') checks.
 */

/**
 * Internal export solely for testing.
 * @internal
 */
export function getSurveyState(): SurveyState | undefined {
    return process.env.NODE_ENV === 'test' ? surveyState : undefined;
}

/**
 * Internal export solely for testing.
 * @internal
 */
export function getSurveyConfig() {
    return process.env.NODE_ENV === 'test' ? SurveyConfig : undefined;
}

/**
 * Internal export solely for testing.
 * @internal
 */
export function getSurveyStateKeys() {
    return process.env.NODE_ENV === 'test' ? StateKeys : undefined;
}
