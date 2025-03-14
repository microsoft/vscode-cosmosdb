/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as semver from 'semver';
import { env, Uri, window } from 'vscode';
import * as nls from 'vscode-nls';
import { ext } from '../extensionVariables';
import { ExperienceKind, type UsageImpact } from './surveyTypes';

const NPS_NOSQL_SURVEY_URL = 'https://aka.ms/AzureDatabasesSurvey';
const NPS_MONGO_SURVEY_URL = 'https://aka.ms/AzureDatabasesSurvey/mongo';

// Survey settings
const DEBUG_ALWAYS_PROMPT = false; // setting to true will always prompt the survey ignoring all conditions
const DISABLE_SURVEY = false; // setting to true will disable the survey
const PROBABILITY = 1; // Probability to become a candidate, Azure Tools has 0.15
const PROMPT_ENGLISH_ONLY = false; // TODO: do we want to survey non-English users? Needs survey to be localized?
const PROMPT_VERSION_ONLY_ONCE = true; // only prompt once per major/minor version
const PROMPT_DATE_ONLY_ONCE = true; // only prompt once per day
const MIN_SESSIONS_BEFORE_PROMPT = 9; // skip the first N sessions after installing or rearming after update
const SNOOZE_SESSIONS = 3; // snooze for N sessions after "remind me later"
const REARM_AFTER_DAYS = 90;
const REARM_OPT_OUT = true;

const REQUIRED_SCORE = 100; // Score needed to trigger survey
const MAX_SCORE = 1000; // Score Cap to prevent overcounting, could also be Number.MAX_SAFE_INTEGER - REQUIRED_SCORE

const STATE_KEY_BASE = 'ms-azuretools.vscode-cosmosdb.survey';
const SESSION_COUNT_KEY = `${STATE_KEY_BASE}/sessionCount`;
const LAST_SESSION_DATE_KEY = `${STATE_KEY_BASE}/lastSessionDate`;
const SKIP_VERSION_KEY = `${STATE_KEY_BASE}/skipVersion`; // skip this version, will be set to the version where the user clicked "Don't Ask Again" or opened the survey
const SURVEY_TAKEN_DATE_KEY = `${STATE_KEY_BASE}/surveyTaken`;
const OPT_OUT_DATE_KEY = `${STATE_KEY_BASE}/surveyOptOut`;

const localize = nls.loadMessageBundle();
let isCandidate: boolean | undefined = undefined;
// this will be set to true if the user interacts with the prompt,
// from there on whole logic will be disarmed for the rest of the session including scoring
let wasPromptedInSession: boolean = false;

const usageScoreByExperience: Record<ExperienceKind, number> = {
    [ExperienceKind.Mongo]: 0,
    [ExperienceKind.NoSQL]: 0,
};

export function countExperienceUsageForSurvey(experience: ExperienceKind, score: UsageImpact | number): void {
    if (DISABLE_SURVEY || wasPromptedInSession) {
        return;
    }
    usageScoreByExperience[experience] = Math.min(MAX_SCORE, usageScoreByExperience[experience] + score);
}

export async function promptAfterActionEventually(
    experience: ExperienceKind,
    score: UsageImpact | number,
    triggerAction?: string,
): Promise<void> {
    if (DISABLE_SURVEY || wasPromptedInSession) {
        return;
    }

    countExperienceUsageForSurvey(experience, score);

    const { fullScore, highestExperience } = (
        Object.entries(usageScoreByExperience) as [ExperienceKind, number][]
    ).reduce(
        (acc, entry) => {
            acc.fullScore = Math.min(MAX_SCORE, acc.fullScore + entry[1]);
            if (entry[1] > acc.highestExperience[1]) {
                acc.highestExperience = entry;
            }
            return acc;
        },
        { fullScore: 0, highestExperience: [ExperienceKind.Mongo, 0] as [ExperienceKind, number] }, // initial value
    );

    if (fullScore >= REQUIRED_SCORE) {
        await surveyPromptIfCandidate(highestExperience[0], triggerAction);
    }
}

export async function getIsSurveyCandidate(): Promise<boolean> {
    if (DISABLE_SURVEY) {
        return false;
    }
    if (isCandidate === undefined) {
        await initSurvey();
    }
    return isCandidate ?? false;
}

async function initSurvey(): Promise<void> {
    await callWithTelemetryAndErrorHandling('survey.init', async (context: IActionContext) => {
        if (DEBUG_ALWAYS_PROMPT) {
            context.telemetry.properties.isCandidate = (isCandidate = true).toString();
            return;
        }

        // Prompt only for English locales
        if (PROMPT_ENGLISH_ONLY && env.language !== 'en' && !env.language.startsWith('en-')) {
            context.telemetry.properties.isCandidate = (isCandidate = false).toString();
            return;
        }

        // Prompt only once per major/minor version,
        // SKIP_VERSION_KEY will be set to the version that was prompted already and the user either clicked "Don't Ask Again" or opened the survey
        const extensionVersion = (ext.context.extension.packageJSON as { version: string }).version;
        const extensionSemVer = semver.parse(extensionVersion);
        const skipVersion = semver.parse(ext.context.globalState.get(SKIP_VERSION_KEY, ''));
        if (PROMPT_VERSION_ONLY_ONCE && skipVersion && extensionSemVer) {
            // don't prompt for the same version, major/minor - ignoring patch versions (don't rearm for patch versions)
            if (extensionSemVer.major === skipVersion.major && extensionSemVer.minor === skipVersion.minor) {
                context.telemetry.properties.isCandidate = (isCandidate = false).toString();
                return;
            }
        }

        const today = new Date();
        const rearmAfterDate = new Date();
        rearmAfterDate.setDate(today.getDate() - REARM_AFTER_DAYS);

        // Skip if Survey has been taken within the last REARM_AFTER_DAYS days
        const surveyTakenDate = new Date(
            ext.context.globalState.get(SURVEY_TAKEN_DATE_KEY, new Date(0).toDateString()),
        );
        if (surveyTakenDate.getTime() >= rearmAfterDate.getTime()) {
            context.telemetry.properties.isCandidate = (isCandidate = false).toString();
            return;
        }

        // Check if the user has opted out
        const optOutDateString = ext.context.globalState.get(OPT_OUT_DATE_KEY, undefined);
        if (optOutDateString) {
            // Skip if opted out within the last REARM_AFTER_DAYS days
            const optOutDate = new Date(optOutDateString);
            if (!REARM_OPT_OUT || optOutDate.getTime() >= rearmAfterDate.getTime()) {
                context.telemetry.properties.isCandidate = (isCandidate = false).toString();
                return;
            }
        }

        // Prompt only once per day,
        // LAST_SESSION_DATE_KEY will be set to the last date the user was prompted
        const lastSessionDate = new Date(ext.context.globalState.get(LAST_SESSION_DATE_KEY, new Date(0).toISOString()));
        if (PROMPT_DATE_ONLY_ONCE && today.toDateString() === lastSessionDate.toDateString()) {
            context.telemetry.properties.isCandidate = (isCandidate = false).toString();
            return;
        }

        // Count sessions and decide if the user is a candidate
        const sessionCount = ext.context.globalState.get(SESSION_COUNT_KEY, 0) + 1;
        await ext.context.globalState.update(LAST_SESSION_DATE_KEY, today);
        await ext.context.globalState.update(SESSION_COUNT_KEY, sessionCount);
        if (sessionCount < MIN_SESSIONS_BEFORE_PROMPT) {
            context.telemetry.properties.isCandidate = (isCandidate = false).toString();
            return;
        }

        // If the user is a candidate (has not opted out or participated for the current version),
        // decide randomly with given probability
        isCandidate = isCandidate || Math.random() < PROBABILITY;
        context.telemetry.properties.isCandidate = isCandidate.toString();
    });
}

export async function surveyPromptIfCandidate(
    experience: ExperienceKind = ExperienceKind.NoSQL,
    triggerAction?: string,
): Promise<void> {
    if (wasPromptedInSession) {
        return;
    }
    await callWithTelemetryAndErrorHandling('survey.prompt', async (context: IActionContext) => {
        const isCandidate = await getIsSurveyCandidate();
        context.telemetry.properties.isCandidate = isCandidate.toString();
        context.telemetry.properties.experience = experience;
        context.telemetry.properties.triggerAction = triggerAction;
        context.telemetry.properties.userAsked = 'false'; // this will be set to 'true' later if the user interacts with the prompt
        wasPromptedInSession = true; // disarm for the rest of the session
        if (!isCandidate) {
            return;
        }

        const extensionVersion = (ext.context.extension.packageJSON as { version: string }).version;
        const date = new Date().toDateString();
        const surveyUrl = experience === ExperienceKind.Mongo ? NPS_MONGO_SURVEY_URL : NPS_NOSQL_SURVEY_URL;

        const take = {
            title: localize('azureResourceGroups.takeSurvey', 'Take Survey'),
            run: async () => {
                context.telemetry.properties.takeShortSurvey = 'true';
                //NOTE: Customer Voice does not support URL parameters, keeping this comment for reference if we switch to another platform which supports that
                //void env.openExternal(Uri.parse(`${surveyUrl}?o=${encodeURIComponent(process.platform)}&v=${encodeURIComponent(extensionVersion)}&m=${encodeURIComponent(env.machineId)}`));
                void env.openExternal(Uri.parse(surveyUrl));
                await ext.context.globalState.update(SKIP_VERSION_KEY, extensionVersion);
                await ext.context.globalState.update(SESSION_COUNT_KEY, 0);
                await ext.context.globalState.update(SURVEY_TAKEN_DATE_KEY, date);
            },
        };
        const remind = {
            title: localize('azureResourceGroups.remindLater', 'Remind Me Later'),
            run: async () => {
                context.telemetry.properties.remindMeLater = 'true';
                await ext.context.globalState.update(SESSION_COUNT_KEY, MIN_SESSIONS_BEFORE_PROMPT - SNOOZE_SESSIONS);
            },
        };
        const never = {
            title: localize('azureResourceGroups.neverAgain', "Don't Ask Again"),
            isSecondary: true,
            run: async () => {
                context.telemetry.properties.dontShowAgain = 'true';
                await ext.context.globalState.update(SKIP_VERSION_KEY, extensionVersion);
                await ext.context.globalState.update(SESSION_COUNT_KEY, 0);
                await ext.context.globalState.update(OPT_OUT_DATE_KEY, date);
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
