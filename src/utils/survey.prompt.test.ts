/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { getSurveyConfig, getSurveyState, getSurveyStateKeys, promptAfterActionEventually } from './survey';
import { ExperienceKind } from './surveyTypes';

const telemetryContextMock = {
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
};

// Mock vscode-azext-utils module
jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(
        async (_eventName, callback: (context: IActionContext) => Promise<void>) => {
            await callback(telemetryContextMock);
            return undefined; // Explicitly return undefined to match function signature
        },
    ),
}));

// Mock vscode module
jest.mock('vscode', () => ({
    env: {
        openExternal: jest.fn(() => Promise.resolve(true)),
        language: 'en',
    },
    Uri: {
        parse: jest.fn((url) => ({ toString: () => url })),
    },
    window: {
        showInformationMessage: jest.fn(),
    },
}));

// Mock extensionVariables module
jest.mock('../extensionVariables', () => ({
    ext: {
        context: {
            globalState: {
                get: jest.fn(),
                update: jest.fn(() => Promise.resolve()),
            },
            extension: {
                packageJSON: {
                    version: '1.0.0',
                },
            },
        },
    },
}));

describe('Survey Prompt', () => {
    // We know these won't be null because we set NODE_ENV to 'test'
    const surveyConfig = getSurveyConfig()!;
    const surveyState = getSurveyState()!;
    const stateKeys = getSurveyStateKeys()!;

    // Store a reference to the mocked function
    let globalStateUpdateMock: jest.Mock;

    beforeEach(() => {
        // Reset survey state before each test
        surveyState.usageScoreByExperience = {
            [ExperienceKind.Mongo]: 0,
            [ExperienceKind.NoSQL]: 0,
        };
        surveyState.wasPromptedInSession = false;
        surveyState.isCandidate = true;

        // Reset mocks
        jest.clearAllMocks();

        // Store a reference to the update function mock for use in tests
        // eslint-disable-next-line @typescript-eslint/unbound-method
        globalStateUpdateMock = ext.context.globalState.update as jest.Mock;

        // Setup default mock behavior
        (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);
        (ext.context.globalState.get as jest.Mock).mockImplementation((key) => {
            if (key === stateKeys.SESSION_COUNT) return surveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT;
            return undefined;
        });
    });

    describe('prompt conditions', () => {
        test('should not show prompt if wasPromptedInSession is true', async () => {
            // Set wasPromptedInSession to true
            surveyState.wasPromptedInSession = true;

            // Call the function that would trigger surveyPromptIfCandidate
            await promptAfterActionEventually(ExperienceKind.NoSQL, surveyConfig.scoring.REQUIRED_SCORE);

            // Verify showInformationMessage was not called
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        });

        test('should not show prompt if getIsSurveyCandidate returns false', async () => {
            // Make getIsSurveyCandidate return false
            surveyState.isCandidate = false;

            // Call the function that would trigger surveyPromptIfCandidate
            await promptAfterActionEventually(ExperienceKind.NoSQL, surveyConfig.scoring.REQUIRED_SCORE);

            // Verify showInformationMessage was not called
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        });

        test('should set wasPromptedInSession to true after being called', async () => {
            // Ensure conditions to trigger the prompt
            surveyState.wasPromptedInSession = false;

            // Call the function that would trigger surveyPromptIfCandidate
            await promptAfterActionEventually(ExperienceKind.NoSQL, surveyConfig.scoring.REQUIRED_SCORE);

            // Verify wasPromptedInSession was set to true
            expect(surveyState.wasPromptedInSession).toBe(true);
        });
    });

    describe('button interactions', () => {
        test('should show information message with appropriate buttons when conditions are met', async () => {
            // Call the function that would trigger surveyPromptIfCandidate
            await promptAfterActionEventually(ExperienceKind.NoSQL, surveyConfig.scoring.REQUIRED_SCORE);

            // Verify showInformationMessage was called with the expected message
            expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
                expect.stringContaining('feedback survey'),
                expect.objectContaining({ title: expect.stringContaining('Take Survey') }),
                expect.objectContaining({ title: expect.stringContaining('Remind Me Later') }),
                expect.objectContaining({ title: expect.stringContaining("Don't Ask Again") }),
            );
        });

        test('should handle "Take Survey" button click', async () => {
            // Create a mock take survey button with a run function we can capture and execute
            const mockTakeSurveyButton = {
                title: 'Take Survey',
                run: jest.fn(async () => {
                    // The implementation is irrelevant - we just need to capture it was called
                }),
            };

            // Mock the showInformationMessage to return our take button
            (vscode.window.showInformationMessage as jest.Mock).mockImplementation(
                (_message, takeBtn, _remindBtn, _neverBtn) => {
                    // Grab the real run function from the take button passed to showInformationMessage
                    mockTakeSurveyButton.run = takeBtn.run;
                    return Promise.resolve(mockTakeSurveyButton);
                },
            );

            // Call the function that would trigger surveyPromptIfCandidate
            await promptAfterActionEventually(ExperienceKind.NoSQL, surveyConfig.scoring.REQUIRED_SCORE);

            // Execute the captured run function
            await mockTakeSurveyButton.run();

            // Verify expected behavior after clicking Take Survey
            expect(vscode.env.openExternal).toHaveBeenCalled();
            expect(globalStateUpdateMock).toHaveBeenCalledWith(
                stateKeys.SKIP_VERSION,
                ext.context.extension.packageJSON.version,
            );
            expect(globalStateUpdateMock).toHaveBeenCalledWith(stateKeys.SESSION_COUNT, 0);
            expect(globalStateUpdateMock).toHaveBeenCalledWith(stateKeys.SURVEY_TAKEN_DATE, expect.any(String));
        });

        test('should handle "Remind Me Later" button click', async () => {
            // Create a mock remind later button with a run function we can capture and execute
            const mockRemindButton = {
                title: 'Remind Me Later',
                run: jest.fn(async () => {
                    // The implementation is irrelevant - we just need to capture it was called
                }),
            };

            // Mock the showInformationMessage to return our remind button
            (vscode.window.showInformationMessage as jest.Mock).mockImplementation(
                (_message, _takeBtn, remindBtn, _neverBtn) => {
                    // Grab the real run function from the remind button passed to showInformationMessage
                    mockRemindButton.run = remindBtn.run;
                    return Promise.resolve(mockRemindButton);
                },
            );

            // Call the function that would trigger surveyPromptIfCandidate
            await promptAfterActionEventually(ExperienceKind.NoSQL, surveyConfig.scoring.REQUIRED_SCORE);

            // Execute the captured run function
            await mockRemindButton.run();

            // Verify expected behavior after clicking Remind Me Later
            expect(globalStateUpdateMock).toHaveBeenCalledWith(
                stateKeys.SESSION_COUNT,
                surveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT - surveyConfig.settings.SNOOZE_SESSIONS,
            );
        });

        test('should handle "Don\'t Ask Again" button click', async () => {
            // Create a mock never button with a run function we can capture and execute
            const mockNeverButton = {
                title: "Don't Ask Again",
                isSecondary: true,
                run: jest.fn(async () => {
                    // The implementation is irrelevant - we just need to capture it was called
                }),
            };

            // Mock the showInformationMessage to return our never button
            (vscode.window.showInformationMessage as jest.Mock).mockImplementation(
                (_message, _takeBtn, _remindBtn, neverBtn) => {
                    // Grab the real run function from the never button passed to showInformationMessage
                    mockNeverButton.run = neverBtn.run;
                    return Promise.resolve(mockNeverButton);
                },
            );

            // Call the function that would trigger surveyPromptIfCandidate
            await promptAfterActionEventually(ExperienceKind.NoSQL, surveyConfig.scoring.REQUIRED_SCORE);

            // Execute the captured run function
            await mockNeverButton.run();

            // Verify expected behavior after clicking Don't Ask Again - use the stored mock reference
            expect(globalStateUpdateMock).toHaveBeenCalledWith(
                stateKeys.SKIP_VERSION,
                ext.context.extension.packageJSON.version,
            );
            expect(globalStateUpdateMock).toHaveBeenCalledWith(stateKeys.SESSION_COUNT, 0);
            expect(globalStateUpdateMock).toHaveBeenCalledWith(stateKeys.OPT_OUT_DATE, expect.any(String));
        });

        test('should default to "Remind Me Later" if no button is clicked', async () => {
            // Setup no button clicked (undefined response)
            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

            // Call the function that would trigger surveyPromptIfCandidate
            await promptAfterActionEventually(ExperienceKind.NoSQL, surveyConfig.scoring.REQUIRED_SCORE);

            // Verify the Remind Me Later behavior still happens as default
            expect(globalStateUpdateMock).toHaveBeenCalledWith(
                stateKeys.SESSION_COUNT,
                surveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT - surveyConfig.settings.SNOOZE_SESSIONS,
            );
        });
    });

    describe('telemetry', () => {
        test('should record experience type in telemetry when showing prompt', async () => {
            // Setup a more sophisticated mock that captures the context
            const telemetryContexts: IActionContext[] = [];

            (
                jest.requireMock('@microsoft/vscode-azext-utils').callWithTelemetryAndErrorHandling as jest.Mock
            ).mockImplementation(async (eventName: string, callback: (context: IActionContext) => Promise<void>) => {
                const context: IActionContext = telemetryContextMock;

                // Store the context for later inspection if it's the event we care about
                if (eventName === 'survey.prompt') {
                    telemetryContexts.push(context);
                }

                await callback(context);
                return undefined;
            });

            // Trigger the prompt with Mongo experience
            await promptAfterActionEventually(ExperienceKind.Mongo, surveyConfig.scoring.REQUIRED_SCORE);

            // Verify the telemetry context properties
            expect(telemetryContexts.length).toBeGreaterThan(0);
            const surveyPromptContext = telemetryContexts[0];
            expect(surveyPromptContext.telemetry.properties.experience).toBe(ExperienceKind.Mongo);
            expect(surveyPromptContext.telemetry.properties.isCandidate).toBe('true');
            expect(surveyPromptContext.telemetry.properties.userAsked).toBe('true');
        });
    });
});
