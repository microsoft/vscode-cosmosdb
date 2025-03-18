/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../extensionVariables';
import { getIsSurveyCandidate, getSurveyConfig, getSurveyState, getSurveyStateKeys } from './survey';

let globalState: { get: jest.Mock; update: jest.Mock };
// Using type assertion here to tell TypeScript that we're confident getSurveyConfig() will not return undefined
// in the test environment. This approach avoids null checks throughout the test code but requires the validation
// in beforeAll() to fail the test explicitly if the assumption is incorrect.
const SurveyConfig = getSurveyConfig() as NonNullable<ReturnType<typeof getSurveyConfig>>;
const StateKeys = getSurveyStateKeys() as NonNullable<ReturnType<typeof getSurveyStateKeys>>;
const SurveyState = getSurveyState() as NonNullable<ReturnType<typeof getSurveyState>>;

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

beforeAll(() => {
    if (!SurveyState || !SurveyConfig || !SurveyConfig.settings || !StateKeys) {
        throw new Error('SurveyState is missing or invalid. Please compile with "test" mode when using webpack.');
    }
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

    function resetSurveyState(): void {
        jest.restoreAllMocks();
        SurveyState.isCandidate = undefined;
        SurveyState.wasPromptedInSession = false;
    }

    afterEach(() => {
        resetSurveyState();
    });

    function mockSurveyTaken(date: Date, version: string): void {
        expect(SurveyConfig).toBeDefined();
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
            const date = new Date();
            date.setDate(date.getDate() + daysOffset);

            mockGlobalStateValues({
                [StateKeys.LAST_SESSION_DATE]: date.toDateString(),
            });

            expect(await getIsSurveyCandidate()).toBe(shouldBeCandidate);
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
                mockGlobalStateValues({
                    [StateKeys.SESSION_COUNT]: initialCount,
                });

                expect(await getIsSurveyCandidate()).toBe(shouldBeCandidate);
                expect(globalState.update).toHaveBeenCalledWith(StateKeys.SESSION_COUNT, expectedCount);
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
                mockGlobalStateValues({
                    [StateKeys.SKIP_VERSION]: skipVersion,
                });

                expect(await getIsSurveyCandidate()).toBe(shouldBeCandidate);
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
                const date = new Date();
                date.setDate(date.getDate() - daysSince);

                // Call the appropriate mock based on the test type
                if (testType === 'Survey taken') {
                    mockSurveyTaken(date, version);
                } else {
                    // 'Opted Out'
                    mockOptedOut(date, version);
                }

                expect(await getIsSurveyCandidate()).toBe(shouldBeCandidate);
            });
        });
    });

    describe('Enable Survey with a given Probability', () => {
        test.each([
            [0, true], // random < PROBABILITY => shouldBeCandidate
            [Math.min(1, SurveyConfig.settings.PROBABILITY), false], // random >= PROBABILITY => shouldNotBeCandidate
        ])('random value %s => candidate: %s', async (mockRandom, shouldBeCandidate) => {
            jest.spyOn(Math, 'random').mockReturnValue(mockRandom);

            mockGlobalStateValues({}); // Provide no disqualifying conditions

            expect(await getIsSurveyCandidate()).toBe(shouldBeCandidate);
        });
    });

    describe('Remind Me Later functionality', () => {
        test('Should postpone prompting for SNOOZE_SESSIONS after clicking Remind Me Later', async () => {
            // Starting point: User has just clicked "Remind Me Later"
            // This sets the count to MIN_SESSIONS_BEFORE_PROMPT - SNOOZE_SESSIONS
            const initialCount =
                SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT - SurveyConfig.settings.SNOOZE_SESSIONS;
            mockGlobalStateValues({
                [StateKeys.SESSION_COUNT]: initialCount,
            });

            // First session after clicking "Remind Me Later"
            // below threshold, so user should not be a candidate
            expect(await getIsSurveyCandidate()).toBe(false);

            // Session count should be incremented by 1
            expect(globalState.update).toHaveBeenCalledWith(StateKeys.SESSION_COUNT, initialCount + 1);

            // Reset mocks for next initSurvey call
            resetSurveyState();

            // Mock the last session before the threshold
            const lastSnoozedSession = SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT - 1;
            mockGlobalStateValues({
                [StateKeys.SESSION_COUNT]: lastSnoozedSession,
            });

            // Another session - this should reach the threshold
            expect(await getIsSurveyCandidate()).toBe(true);

            // Session count should be incremented to the threshold
            expect(globalState.update).toHaveBeenCalledWith(
                StateKeys.SESSION_COUNT,
                SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT,
            );
        });
    });
});
