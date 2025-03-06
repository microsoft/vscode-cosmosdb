/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as semver from 'semver';
import { env, Uri, window } from 'vscode';
import * as nls from 'vscode-nls';
import { ext } from '../extensionVariables';

const localize = nls.loadMessageBundle();

const NPS_NOSQL_SURVEY_URL = 'https://aka.ms/AzureDatabasesSurvey';
const NPS_MONGO_SURVEY_URL = 'https://aka.ms/AzureDatabasesSurvey/mongo';

const STATE_KEY_BASE = 'ms-azuretools.vscode-cosmosdb.survey';
const SESSION_COUNT_KEY = `${STATE_KEY_BASE}/sessionCount`;
const LAST_SESSION_DATE_KEY = `${STATE_KEY_BASE}/lastSessionDate`;
const SKIP_VERSION_KEY = `${STATE_KEY_BASE}/skipVersion`; // skip this version, will be set to the version where the user clicked "Don't Ask Again" or opened the survey
const IS_CANDIDATE_KEY = `${STATE_KEY_BASE}/isCandidate`; // stores the last decision if the user is a candidate, currently not used anywhere

// Survey settings
const DEBUG_ALWAYS_PROMPT = false; // setting to true will always prompt the survey ignoring all conditions
const PROBABILITY = 1; // Probability to become a candidate, Azure Tools has 0.15
const PROMPT_ENGLISH_ONLY = false; // TODO: do we want to survey non-English users? Needs survey to be localized?
const PROMPT_VERSION_ONLY_ONCE = true; // only prompt once per major/minor version
const PROMPT_DATE_ONLY_ONCE = true; // only prompt once per day
const SKIP_INITIAL_SESSIONS = 9; // skip the first N sessions after installing or rearming after update
const SNOOZE_SESSIONS = 3; // snooze for N sessions after "remind me later"

let isCandidate: boolean | undefined = undefined;
let wasPromptedInSession: boolean = false;

export enum UsageImpact {
    Low = 5,
    Medium = 10,
    High = 20,
}

export enum ExperienceKind {
    Mongo = 'Mongo',
    NoSQL = 'NoSQL',
}

const usageScoreByExperience: Record<ExperienceKind, number> = {
    [ExperienceKind.Mongo]: 0,
    [ExperienceKind.NoSQL]: 0,
};

export function countExperienceUsageForSurvey(experience: ExperienceKind, score: UsageImpact | number): void {
    usageScoreByExperience[experience] += score;
}

export async function promptAfterActionEventually(
    experience: ExperienceKind,
    score: UsageImpact | number,
): Promise<void> {
    usageScoreByExperience[experience] += score;

    let fullScore = 0;
    const highestExperience = (Object.entries(usageScoreByExperience) as [ExperienceKind, number][]).reduce(
        (max, entry) => {
            fullScore += entry[1];
            return entry[1] > max[1] ? entry : max;
        },
    )[0];

    if (fullScore >= 100) {
        await surveyPromptIfCandidate(highestExperience);
    }
}

export async function getIsSurveyCandidate(): Promise<boolean> {
    if (isCandidate === undefined) {
        await initSurvey();
    }
    return isCandidate ?? false;
}

export async function initSurvey(): Promise<void> {
    //TODO: REMOVE! This is a test
    //await new Promise((resolve) => setTimeout(resolve, 5000));

    await callWithTelemetryAndErrorHandling('survey.init', async (context: IActionContext) => {
        if (DEBUG_ALWAYS_PROMPT) {
            context.telemetry.properties.isCandidate = (isCandidate = true).toString();
            await ext.context.globalState.update(IS_CANDIDATE_KEY, isCandidate);
            return;
        }

        //TODO: REMOVE! This is a test
        //await ext.context.globalState.update(SESSION_COUNT_KEY, 20);
        //await ext.context.globalState.update(SKIP_VERSION_KEY, null);

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

        // Prompt only once per day,
        // LAST_SESSION_DATE_KEY will be set to the last date the user was prompted
        const date = new Date().toDateString();
        const lastSessionDate = ext.context.globalState.get(LAST_SESSION_DATE_KEY, new Date(0).toDateString());
        if (PROMPT_DATE_ONLY_ONCE && date === lastSessionDate) {
            context.telemetry.properties.isCandidate = (isCandidate = false).toString();
            return;
        }

        // Count sessions and decide if the user is a candidate
        const sessionCount = ext.context.globalState.get(SESSION_COUNT_KEY, 0) + 1;
        await ext.context.globalState.update(LAST_SESSION_DATE_KEY, date);
        await ext.context.globalState.update(SESSION_COUNT_KEY, sessionCount);
        if (sessionCount < SKIP_INITIAL_SESSIONS) {
            context.telemetry.properties.isCandidate = (isCandidate = false).toString();
            return;
        }

        // If the user is a candidate (has not opted out or participated for the current version),
        // decide randomly with given probability
        isCandidate = ext.context.globalState.get(IS_CANDIDATE_KEY, false) || Math.random() < PROBABILITY;
        context.telemetry.properties.isCandidate = isCandidate.toString();
        await ext.context.globalState.update(IS_CANDIDATE_KEY, isCandidate);
    });
}

export async function surveyPromptIfCandidate(experience: ExperienceKind = ExperienceKind.NoSQL): Promise<void> {
    await callWithTelemetryAndErrorHandling('survey.prompt', async (context: IActionContext) => {
        const isCandidate = await getIsSurveyCandidate();
        context.telemetry.properties.isCandidate = isCandidate.toString();
        if (!isCandidate || wasPromptedInSession) {
            return;
        }
        wasPromptedInSession = true; // don't prompt again in this session

        const extensionVersion = (ext.context.extension.packageJSON as { version: string }).version;
        const surveyUrl = experience === ExperienceKind.Mongo ? NPS_MONGO_SURVEY_URL : NPS_NOSQL_SURVEY_URL;

        const take = {
            title: localize('azureResourceGroups.takeSurvey', 'Take Survey'),
            run: async () => {
                context.telemetry.properties.takeShortSurvey = 'true';
                //NOTE: Customer Voice does not support URL parameters, keeping this comment for reference if we switch to another platform which supports that
                //void env.openExternal(Uri.parse(`${surveyUrl}?o=${encodeURIComponent(process.platform)}&v=${encodeURIComponent(extensionVersion)}&m=${encodeURIComponent(env.machineId)}`));
                void env.openExternal(Uri.parse(surveyUrl));
                await ext.context.globalState.update(IS_CANDIDATE_KEY, false);
                await ext.context.globalState.update(SKIP_VERSION_KEY, extensionVersion);
                await ext.context.globalState.update(SESSION_COUNT_KEY, 0);
            },
        };
        const remind = {
            title: localize('azureResourceGroups.remindLater', 'Remind Me Later'),
            run: async () => {
                context.telemetry.properties.remindMeLater = 'true';
                await ext.context.globalState.update(SESSION_COUNT_KEY, SKIP_INITIAL_SESSIONS - SNOOZE_SESSIONS + 1);
            },
        };
        const never = {
            title: localize('azureResourceGroups.neverAgain', "Don't Ask Again"),
            isSecondary: true,
            run: async () => {
                context.telemetry.properties.dontShowAgain = 'true';
                await ext.context.globalState.update(IS_CANDIDATE_KEY, false);
                await ext.context.globalState.update(SKIP_VERSION_KEY, extensionVersion);
                await ext.context.globalState.update(SESSION_COUNT_KEY, 0);
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
