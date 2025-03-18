/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import crypto from 'crypto';
import { ext } from '../extensionVariables';

// Mock the vscode module
jest.mock('vscode', () => ({
    env: {
        machineId: 'default-machine-id',
        language: 'en',
        openExternal: jest.fn(),
    },
}));

import { env } from 'vscode';
import { getIsSurveyCandidate, getSurveyConfig, getSurveyState, getSurveyStateKeys } from './survey';

let globalState: { get: jest.Mock; update: jest.Mock };
// Using type assertion here to tell TypeScript that we're confident getSurveyConfig() will not return undefined
// in the test environment.
const SurveyConfig = getSurveyConfig() as NonNullable<ReturnType<typeof getSurveyConfig>>;
const StateKeys = getSurveyStateKeys() as NonNullable<ReturnType<typeof getSurveyStateKeys>>;
// Important: This is NOT a mock but a direct reference to the actual surveyState object in survey.ts
// The getSurveyState() function returns the real surveyState instance when NODE_ENV is 'test'
// So any modifications to this object will directly affect the surveyState in the survey.ts module
const surveyStateRef = getSurveyState() as NonNullable<ReturnType<typeof getSurveyState>>;

const currentExtensionVersion = '1.1.1';
const previousPatchExtensionVersion = '1.1.0';
const previousMinorExtensionVersion = '1.0.0';
const previousMajorExtensionVersion = '0.1.1';

jest.mock('@microsoft/vscode-azext-utils', () => {
    return {
        // Only mock the callWithTelemetryAndErrorHandling function that we need
        callWithTelemetryAndErrorHandling: jest.fn(async (_eventName, callback: (context: any) => Promise<void>) => {
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
        }),
    };
});

beforeAll(() => {
    // Verify the exported references are available
    if (!surveyStateRef || !SurveyConfig || !SurveyConfig.settings || !StateKeys) {
        throw new Error('SurveyState is missing or invalid. Please compile with "test" mode when using webpack.');
    }
});

/**
 * Tests for survey initialization logic
 * These tests verify that users are correctly identified as survey candidates
 * based on version, session count, date‐ and time‐based triggers, as well as the new AB test logic.
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
        // Reset any previously set candidate flag
        // This directly modifies the surveyState object in the survey.ts module
        surveyStateRef.isCandidate = undefined;

        // Set up default A/B test mocks for passing
        mockABTestPassing();

        // Set a consistent machine ID
        (env as any).machineId = 'test-machine-id';
    });

    function resetSurveyState(): void {
        jest.restoreAllMocks();
        // These modifications directly affect the original surveyState object in survey.ts
        surveyStateRef.isCandidate = undefined;
        surveyStateRef.wasPromptedInSession = false;
    }

    afterEach(() => {
        resetSurveyState();
    });

    // Helper to mock the crypto hash to always pass A/B test
    function mockABTestPassing() {
        jest.spyOn(crypto, 'createHash').mockImplementation(() => {
            return {
                update: () => ({
                    digest: () => {
                        // Create a buffer with first 4 bytes that will produce a low value
                        // 0x0a000000 as the first 4 bytes = 167772160 (decimal)
                        // 167772160 / 0xffffffff ≈ 0.039 (well below threshold)
                        const buffer = Buffer.alloc(16); // MD5 produces 16 bytes
                        buffer.writeUInt32BE(0x0a000000, 0);
                        return buffer;
                    }
                }),
            } as any;
        });

        // Also mock Math.random as fallback
        jest.spyOn(Math, 'random').mockReturnValue(0.1); // Ensure PROBABILITY check passes
    }

    // Helper to mock the crypto hash to always fail A/B test
    function mockABTestFailing() {
        jest.spyOn(crypto, 'createHash').mockImplementation(() => {
            return {
                update: () => ({
                    digest: () => {
                        // Create a buffer with first 4 bytes that will produce a high value
                        // 0xf0000000 as the first 4 bytes = 4026531840 (decimal)
                        // 4026531840 / 0xffffffff ≈ 0.937 (well above threshold)
                        const buffer = Buffer.alloc(16); // MD5 produces 16 bytes
                        buffer.writeUInt32BE(0xf0000000, 0);
                        return buffer;
                    }
                }),
            } as any;
        });

        // Also mock Math.random as fallback
        jest.spyOn(Math, 'random').mockReturnValue(0.9); // Ensure PROBABILITY check fails
    }

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
                [StateKeys.LAST_SESSION_DATE]: date.toISOString(),
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

        test('should respect A/B test and not mark as candidate when hash fails threshold', async () => {
            mockABTestFailing();
            mockGlobalStateValues({
                [StateKeys.SESSION_COUNT]: SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT,
            });

            expect(await getIsSurveyCandidate()).toBe(false);
        });
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

                if (testType === 'Survey taken') {
                    mockSurveyTaken(date, version);
                } else {
                    // 'Opted Out'
                    mockOptedOut(date, version);
                }

                expect(await getIsSurveyCandidate()).toBe(shouldBeCandidate);
            });

            test(`Should not mark as candidate when A/B test fails`, async () => {
                mockABTestFailing();
                const date = new Date();
                date.setDate(date.getDate() - daysSince);

                if (testType === 'Survey taken') {
                    mockSurveyTaken(date, version);
                } else {
                    // 'Opted Out'
                    mockOptedOut(date, version);
                }

                // Regardless of other conditions, A/B test failure should result in false
                expect(await getIsSurveyCandidate()).toBe(false);
            });
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

            resetSurveyState();
            mockABTestPassing(); // Re-setup mocks after reset

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

        test('Should not mark as candidate when above threshold but A/B test fails', async () => {
            mockABTestFailing();

            // User has sufficient sessions for candidacy
            mockGlobalStateValues({
                [StateKeys.SESSION_COUNT]: SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT,
            });

            // But should be rejected due to A/B test
            expect(await getIsSurveyCandidate()).toBe(false);
        });
    });

    describe('A/B Test Evaluation', () => {
        // For these tests we want to force the AB test branch. In order to do that,
        beforeEach(() => {
            globalState = {
                get: jest.fn(),
                update: jest.fn(),
            };
            (ext.context as any) = {
                globalState,
                extension: { packageJSON: { version: currentExtensionVersion } },
            };
            mockGlobalStateValues({
                [StateKeys.SESSION_COUNT]: SurveyConfig.settings.MIN_SESSIONS_BEFORE_PROMPT,
            });
        });

        // Helper that sets up the globalState.get mock in one place
        function mockGlobalStateValues(values: Record<string, unknown>): void {
            globalState.get.mockImplementation((key: string) => values[key]);
        }

        afterEach(() => {
            jest.restoreAllMocks();
        });

        test.each([
            // For a machine id that produces a hash whose first 4 bytes represent a value
            // that when divided by 0xffffffff is less than A_B_TEST_SELECTION
            ['acceptedMachine', 0x0a000000, true],
            // For a machine id that produces a hash yielding a high normalized value
            ['rejectedMachine', 0xf0000000, false],
        ])('with machineId %s producing hash int %s should mark candidate as %s', async (machineId, hashInt, expected) => {
            (env as any).machineId = machineId;
            jest.spyOn(crypto, 'createHash').mockImplementation(() => {
                return {
                    update: () => ({
                        digest: () => {
                            const buffer = Buffer.alloc(16); // MD5 produces 16 bytes
                            buffer.writeUInt32BE(hashInt, 0);
                            return buffer;
                        }
                    }),
                } as any;
            });
            expect(await getIsSurveyCandidate()).toBe(expected);
        });

        test('Fallback to probability when crypto.createHash fails', async () => {
            (env as any).machineId = 'anyMachine';
            jest.spyOn(crypto, 'createHash').mockImplementation(() => {
                throw new Error('hash failure');
            });
            // For fallback, candidate is determined by Math.random < PROBABILITY.
            jest.spyOn(Math, 'random').mockReturnValue(SurveyConfig.settings.PROBABILITY - 0.1);
            expect(await getIsSurveyCandidate()).toBe(true);
        });

        test('Fallback should respect probability threshold', async () => {
            (env as any).machineId = 'anyMachine';
            jest.spyOn(crypto, 'createHash').mockImplementation(() => {
                throw new Error('hash failure');
            });
            // Simulate Math.random returning a value higher than PROBABILITY
            jest.spyOn(Math, 'random').mockReturnValue(SurveyConfig.settings.PROBABILITY + 0.1);
            expect(await getIsSurveyCandidate()).toBe(false);
        });
    });
});
