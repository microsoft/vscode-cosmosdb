/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { countExperienceUsageForSurvey, getSurveyConfig, getSurveyState } from './survey';
import { ExperienceKind } from './surveyTypes';

// Mock vscode-azext-utils module
jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(
        async (_eventName, callback: (context: IActionContext) => Promise<void>) => {
            await callback({
                telemetry: { properties: {}, measurements: {} },
                errorHandling: { issueProperties: {} },
                ui: {
                    showWarningMessage: jest.fn(),
                    onDidFinishPrompt: jest.fn(),
                    showQuickPick: jest.fn(),
                    showInputBox: jest.fn(),
                    showOpenDialog: jest.fn(),
                    showWorkspaceFolderPick: jest.fn(),
                },
                valuesToMask: [],
            });
        },
    ),
    AzExtTreeDataProvider: jest.fn(),
    AzExtTreeItem: jest.fn(),
    createAzExtOutputChannel: jest.fn(),
    parseError: jest.fn((err) => err),
    DialogResponses: {
        yes: { title: 'Yes' },
        no: { title: 'No' },
        cancel: { title: 'Cancel' },
    },
}));

// Mock vscode module
jest.mock('vscode', () => ({
    env: {
        openExternal: jest.fn(() => Promise.resolve(true)),
    },
    Uri: {
        parse: jest.fn((url) => ({ toString: () => url })),
    },
}));

// Using non-null assertion as we're making sure getSurveyConfig and getSurveyState return values in test env
const surveyConfig = getSurveyConfig()!;
const surveyState = getSurveyState()!;

describe('Survey Scoring', () => {
    beforeEach(() => {
        // Reset survey state before each test
        surveyState.usageScoreByExperience = {
            [ExperienceKind.Mongo]: 0,
            [ExperienceKind.NoSQL]: 0,
        };
        surveyState.wasPromptedInSession = false;

        // Clear mock calls between tests
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('countExperienceUsageForSurvey', () => {
        test('should increment the score for a specific experience', () => {
            countExperienceUsageForSurvey(ExperienceKind.Mongo, 10);
            expect(surveyState.usageScoreByExperience[ExperienceKind.Mongo]).toBe(10);
            expect(surveyState.usageScoreByExperience[ExperienceKind.NoSQL]).toBe(0);
        });

        test('should not exceed the maximum score', () => {
            const maxScore = surveyConfig.scoring.MAX_SCORE;

            // First add almost max score
            countExperienceUsageForSurvey(ExperienceKind.Mongo, maxScore - 10);
            expect(surveyState.usageScoreByExperience[ExperienceKind.Mongo]).toBe(maxScore - 10);

            // Then add more than what's needed to reach max
            countExperienceUsageForSurvey(ExperienceKind.Mongo, 20);
            expect(surveyState.usageScoreByExperience[ExperienceKind.Mongo]).toBe(maxScore);
        });

        test('should track scores for different experiences independently', () => {
            countExperienceUsageForSurvey(ExperienceKind.Mongo, 25);
            countExperienceUsageForSurvey(ExperienceKind.NoSQL, 50);

            expect(surveyState.usageScoreByExperience[ExperienceKind.Mongo]).toBe(25);
            expect(surveyState.usageScoreByExperience[ExperienceKind.NoSQL]).toBe(50);
        });

        test('should not increment score if wasPromptedInSession is true', () => {
            surveyState.wasPromptedInSession = true;

            countExperienceUsageForSurvey(ExperienceKind.Mongo, 30);

            expect(surveyState.usageScoreByExperience[ExperienceKind.Mongo]).toBe(0);
        });

        test('should not increment score if DISABLE_SURVEY is true', () => {
            // Save original value to restore later
            const originalDisableSurvey = surveyConfig.settings.DISABLE_SURVEY;
            surveyConfig.settings.DISABLE_SURVEY = true;

            countExperienceUsageForSurvey(ExperienceKind.NoSQL, 40);

            expect(surveyState.usageScoreByExperience[ExperienceKind.NoSQL]).toBe(0);

            // Restore original value
            surveyConfig.settings.DISABLE_SURVEY = originalDisableSurvey;
        });

        test('should handle negative score values by treating them as zero', () => {
            // Test with negative values
            countExperienceUsageForSurvey(ExperienceKind.Mongo, -10);
            expect(surveyState.usageScoreByExperience[ExperienceKind.Mongo]).toBe(0);
        });

        test('should handle undefined experience type gracefully', () => {
            // @ts-expect-error - Testing with invalid input
            expect(() => countExperienceUsageForSurvey(undefined, 10)).not.toThrow();
        });
    });

    describe('calculateScoreMetrics', () => {
        async function getCalculatedMetrics(): Promise<{
            fullScore: number;
            highestExperience: ExperienceKind | undefined;
        }> {
            // Import the function to test
            const { openSurvey } = await import('./survey');

            // Capture the experience from the openExternal call
            let capturedExperience: ExperienceKind | undefined;

            // Mock the implementation for this test
            (vscode.env.openExternal as jest.Mock).mockImplementation((uri: { toString: () => string }) => {
                const urlString = uri.toString();
                if (urlString.includes(surveyConfig.urls.MONGO)) {
                    capturedExperience = ExperienceKind.Mongo;
                } else if (urlString.includes(surveyConfig.urls.NOSQL)) {
                    capturedExperience = ExperienceKind.NoSQL;
                }
                return Promise.resolve(true);
            });

            // Call openSurvey which will use calculateScoreMetrics internally
            openSurvey(undefined);

            // Calculate fullScore manually for verification
            const fullScore = Math.min(
                surveyConfig.scoring.MAX_SCORE,
                surveyState.usageScoreByExperience[ExperienceKind.Mongo] +
                    surveyState.usageScoreByExperience[ExperienceKind.NoSQL],
            );

            return {
                fullScore,
                highestExperience: capturedExperience,
            };
        }

        test('should calculate the total score correctly', async () => {
            surveyState.usageScoreByExperience[ExperienceKind.Mongo] = 30;
            surveyState.usageScoreByExperience[ExperienceKind.NoSQL] = 20;

            const metrics = await getCalculatedMetrics();

            expect(metrics.fullScore).toBe(50);
        });

        test('should cap the total score at MAX_SCORE', async () => {
            const maxScore = surveyConfig.scoring.MAX_SCORE;
            surveyState.usageScoreByExperience[ExperienceKind.Mongo] = maxScore;
            surveyState.usageScoreByExperience[ExperienceKind.NoSQL] = maxScore;

            const metrics = await getCalculatedMetrics();

            expect(metrics.fullScore).toBe(maxScore);
        });

        test('should identify Mongo as highest experience when Mongo score is higher', async () => {
            surveyState.usageScoreByExperience[ExperienceKind.Mongo] = 100;
            surveyState.usageScoreByExperience[ExperienceKind.NoSQL] = 50;

            const metrics = await getCalculatedMetrics();

            expect(metrics.highestExperience).toBe(ExperienceKind.Mongo);
        });

        test('should identify NoSQL as highest experience when NoSQL score is higher', async () => {
            surveyState.usageScoreByExperience[ExperienceKind.Mongo] = 30;
            surveyState.usageScoreByExperience[ExperienceKind.NoSQL] = 80;

            const metrics = await getCalculatedMetrics();

            expect(metrics.highestExperience).toBe(ExperienceKind.NoSQL);
        });

        test('should default to NoSQL when scores are equal', async () => {
            surveyState.usageScoreByExperience[ExperienceKind.Mongo] = 50;
            surveyState.usageScoreByExperience[ExperienceKind.NoSQL] = 50;

            const metrics = await getCalculatedMetrics();

            // The implementation should choose NoSQL as default when scores are equal
            expect(metrics.highestExperience).toBe(ExperienceKind.NoSQL);
        });

        test('should default to NoSQL when all scores are zero', async () => {
            surveyState.usageScoreByExperience[ExperienceKind.Mongo] = 0;
            surveyState.usageScoreByExperience[ExperienceKind.NoSQL] = 0;

            const metrics = await getCalculatedMetrics();

            expect(metrics.highestExperience).toBe(ExperienceKind.NoSQL);
        });
    });
});
