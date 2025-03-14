/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../extensionVariables';
import { initSurvey, StateKeys, SurveyConfig, surveyState } from './survey';

let globalState: { get: jest.Mock; update: jest.Mock };

const currentExtensionVersion = '1.1.1';
const previousPatchExtensionVersion = '1.1.0';
const previousMinorExtensionVersion = '1.0.0';
const previousMajorExtensionVersion = '0.1.1';

jest.mock('@microsoft/vscode-azext-utils', () => {
    const actualModule = jest.requireActual('@microsoft/vscode-azext-utils');
    return {
        ...actualModule, // don't mock the rest of the module
        // Mock out the internal telemetry function to avoid triggering real event emitters
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
                } as IActionContext);
            },
        ),
    };
});

/**
 * Tests for survey initialization logic
 * These tests verify that users are correctly identified as survey candidates
 * based on version, session count, and time-based triggers
 */
describe('Survey Initialization', () => {
    beforeEach(() => {
        globalState = {
            get: jest.fn(),
            update: jest.fn(),
        };
        // Provide the extension context in ext.context
        (ext.context as any) = {
            globalState,
            extension: { packageJSON: { version: currentExtensionVersion } }, // extension version for version based checks
        };
        // ensure not do disqualify user by probability, to reliably test all other conditions
        jest.spyOn(Math, 'random').mockReturnValue(0);
    });

    afterEach(() => {
        jest.restoreAllMocks();

        // Reset survey state after each test
        surveyState.isCandidate = undefined;
        surveyState.wasPromptedInSession = false;
    });

    function assertIsCandidate() {
        expect(surveyState.isCandidate).toBe(true);
    }

    function assertIsNotCandidate() {
        expect(surveyState.isCandidate).toBe(false);
    }

    function mockSurveyTaken(date: Date, version: string): void {
        mockGlobalStateValues({
            [StateKeys.SKIP_VERSION]: version,
            [StateKeys.SESSION_COUNT]: SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT,
            [StateKeys.SURVEY_TAKEN_DATE]: date.toDateString(),
        });
    }

    function mockOptedOut(date: Date, version: string): void {
        mockGlobalStateValues({
            [StateKeys.SKIP_VERSION]: version,
            [StateKeys.SESSION_COUNT]: SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT,
            [StateKeys.OPT_OUT_DATE]: date.toDateString(),
        });
    }

    // Helper that sets up the globalState.get mock in one place
    function mockGlobalStateValues(values: Record<string, unknown>): void {
        globalState.get.mockImplementation((key: string) => values[key]);
    }

    describe('Enable Survey only once per day', () => {
        test.each([
            // [description, daysOffset, shouldBeCandidate]
            ['Should not mark user as candidate if last session was today', 0, false],
            ['Should mark user as candidate if last session was yesterday', -1, true],
        ])('%s', async (_, daysOffset, shouldBeCandidate) => {
            expect.hasAssertions();

            const date = new Date();
            date.setDate(date.getDate() + daysOffset);

            mockGlobalStateValues({
                [StateKeys.LAST_SESSION_DATE]: date.toDateString(),
            });

            await initSurvey();

            if (shouldBeCandidate) {
                assertIsCandidate();
            } else {
                assertIsNotCandidate();
            }
        });
    });

    describe('Enable Survey only after a specific amount of sessions', () => {
        test.each([
            // [sessionCount, expectedNewCount, shouldBeCandidate]
            [0, 1, false], // First session
            [1, 2, false], // Second session
            [
                SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT - 2,
                SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT - 1,
                false,
            ], // Not enough sessions yet
            [
                SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT - 1,
                SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT,
                true,
            ], // Threshold reached
            [
                SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT,
                SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT + 1,
                true,
            ], // Above threshold
        ])(
            'with session count %s should increment to %s and %s mark as candidate',
            async (initialCount, expectedCount, shouldBeCandidate) => {
                expect.hasAssertions();

                mockGlobalStateValues({
                    [StateKeys.SESSION_COUNT]: initialCount,
                });

                await initSurvey();

                expect(globalState.update).toHaveBeenCalledWith(StateKeys.SESSION_COUNT, expectedCount);

                if (shouldBeCandidate) {
                    assertIsCandidate();
                } else {
                    assertIsNotCandidate();
                }
            },
        );
    });

    describe('Rearm survey only after extension update excluding patch releases', () => {
        describe.each([
            // [skipVersion, description, shouldBeCandidate]
            ['current version (1.1.1)', currentExtensionVersion, false],
            ['previous patch release (1.1.0 → 1.1.1)', previousPatchExtensionVersion, false],
            ['previous minor release (1.0.0 → 1.1.1)', previousMinorExtensionVersion, true],
            ['previous major release (0.1.1 → 1.1.1)', previousMajorExtensionVersion, true],
        ])('When Survey was taken for %s', (_description, skipVersion, shouldBeCandidate) => {
            test(`Should ${shouldBeCandidate ? '' : 'not '}mark user as candidate`, async () => {
                expect.hasAssertions();

                mockGlobalStateValues({
                    [StateKeys.SKIP_VERSION]: skipVersion,
                });

                await initSurvey();

                if (shouldBeCandidate) {
                    assertIsCandidate();
                } else {
                    assertIsNotCandidate();
                }
            });
        });
    });

    describe('Rearm survey based on time and version', () => {
        describe.each([
            // [testType, description, daysSince, version, shouldBeCandidate]
            [
                'Survey taken',
                'within rearm window with extension update',
                SurveyConfig.settings.REARM_AFTER_DAYS - 1,
                previousMinorExtensionVersion,
                false,
            ],
            [
                'Survey taken',
                'before rearm window with no extension update',
                SurveyConfig.settings.REARM_AFTER_DAYS + 1,
                currentExtensionVersion,
                false,
            ],
            [
                'Survey taken',
                'before rearm window with extension patch update',
                SurveyConfig.settings.REARM_AFTER_DAYS + 1,
                previousPatchExtensionVersion,
                false,
            ],
            [
                'Survey taken',
                'before rearm window with extension update',
                SurveyConfig.settings.REARM_AFTER_DAYS + 1,
                previousMinorExtensionVersion,
                true,
            ],
            [
                'Opted Out',
                'within rearm window with extension update',
                SurveyConfig.settings.REARM_AFTER_DAYS - 1,
                previousMinorExtensionVersion,
                false,
            ],
            [
                'Opted Out',
                'before rearm window with no extension update',
                SurveyConfig.settings.REARM_AFTER_DAYS + 1,
                currentExtensionVersion,
                false,
            ],
            [
                'Opted Out',
                'before rearm window with extension patch update',
                SurveyConfig.settings.REARM_AFTER_DAYS + 1,
                previousPatchExtensionVersion,
                false,
            ],
            [
                'Opted Out',
                'before rearm window with extension update',
                SurveyConfig.settings.REARM_AFTER_DAYS + 1,
                previousMinorExtensionVersion,
                true,
            ],
        ])('%s %s', (testType, _description, daysSince, version, shouldBeCandidate) => {
            test(`Should ${shouldBeCandidate ? '' : 'not '}mark as candidate`, async () => {
                expect.hasAssertions();

                const date = new Date();
                date.setDate(date.getDate() - daysSince);

                // Call the appropriate mock based on the test type
                if (testType === 'Survey taken') {
                    mockSurveyTaken(date, version);
                } else {
                    // 'Opted Out'
                    mockOptedOut(date, version);
                }

                await initSurvey();

                if (shouldBeCandidate) {
                    assertIsCandidate();
                } else {
                    assertIsNotCandidate();
                }
            });
        });
    });

    describe('Enable Survey with a given Probability', () => {
        test.each([
            [0, true], // random < PROBABILITY => shouldBeCandidate
            [Math.min(1, SurveyConfig.settings.PROBABILITY), false], // random >= PROBABILITY => shouldNotBeCandidate
        ])('random value %s => candidate: %s', async (mockRandom, shouldBeCandidate) => {
            expect.hasAssertions();
            jest.spyOn(Math, 'random').mockReturnValue(mockRandom);

            mockGlobalStateValues({}); // Provide no disqualifying conditions

            await initSurvey();
            if (shouldBeCandidate) {
                assertIsCandidate();
            } else {
                assertIsNotCandidate();
            }
        });
    });

    describe('Remind Me Later functionality', () => {
        test('Should postpone prompting for SNOOZE_SESSIONS after clicking Remind Me Later', async () => {
            expect.hasAssertions();

            // Starting point: User has just clicked "Remind Me Later"
            // This sets the count to MIN_SESSIONS_BEFORE_PROMPT - SNOOZE_SESSIONS
            const initialCount =
                SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT - SurveyConfig.settings.SNOOZE_SESSIONS;
            mockGlobalStateValues({
                [StateKeys.SESSION_COUNT]: initialCount,
            });

            // First session after clicking "Remind Me Later"
            await initSurvey();

            // Session count should be incremented by 1
            expect(globalState.update).toHaveBeenCalledWith(StateKeys.SESSION_COUNT, initialCount + 1);

            // below threshold, so user should not be a candidate
            assertIsNotCandidate();

            // Reset mocks for next initSurvey call
            jest.clearAllMocks();

            // Mock the last session before the threshold
            const lastSnoozedSession = SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT - 1;
            mockGlobalStateValues({
                [StateKeys.SESSION_COUNT]: lastSnoozedSession,
            });

            // Another session - this should reach the threshold
            await initSurvey();

            // Session count should be incremented to the threshold
            expect(globalState.update).toHaveBeenCalledWith(
                StateKeys.SESSION_COUNT,
                SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT,
            );

            // Now the user should be a candidate since we've reached the threshold
            assertIsCandidate();
        });
    });
});
