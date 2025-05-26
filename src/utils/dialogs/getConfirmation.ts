/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DialogResponses, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';

enum ConfirmationStyle {
    wordConfirmation = 'wordConfirmation',
    challengeConfirmation = 'challengeConfirmation',
    buttonConfirmation = 'buttonConfirmation',
}

/**
 * Prompts the user for a confirmation based on the configured confirmation style.
 *
 * @param title - The title of the confirmation dialog.
 * @param message - The message to display in the confirmation dialog. This message will be suffixed with instructions for a specific prompt.
 * @param expectedConfirmationWord - The word that the user must type to confirm the action when the confirmation style is set to 'Word Confirmation'.
 * @returns A promise that resolves to a boolean indicating whether the user confirmed the action.
 */
export async function getConfirmationAsInSettings(
    title: string,
    message: string,
    expectedConfirmationWord: string,
): Promise<boolean> {
    const deleteConfirmation: ConfirmationStyle | undefined = vscode.workspace
        .getConfiguration()
        .get<ConfirmationStyle>(ext.settingsKeys.confirmationStyle);

    if (deleteConfirmation === ConfirmationStyle.wordConfirmation) {
        return await getConfirmationWithWordQuestion(title, message, expectedConfirmationWord);
    } else if (deleteConfirmation === ConfirmationStyle.challengeConfirmation) {
        return await getConfirmationWithNumberQuiz(title, message);
    }

    return await getConfirmationWithClick(title, message);
}

export async function getConfirmationWithWordQuestion(
    title: string,
    message: string,
    expectedConfirmationWord: string,
): Promise<boolean> {
    const result = await vscode.window.showInputBox({
        title: title,
        prompt:
            message +
            '\n\n' +
            l10n.t('Please enter the word "{expectedConfirmationWord}" to confirm the operation.', {
                expectedConfirmationWord,
            }),
        ignoreFocusOut: true,
        validateInput: (val: string | undefined) => {
            if (val && 0 === val.localeCompare(expectedConfirmationWord, undefined, { sensitivity: 'accent' })) {
                return undefined;
            }
            return l10n.t('Please enter the word "{expectedConfirmationWord}" to confirm the operation.', {
                expectedConfirmationWord,
            });
        },
    });

    if (!result) {
        throw new UserCancelledError();
    }

    return 0 === result.localeCompare(expectedConfirmationWord, undefined, { sensitivity: 'accent' });
}

export async function getConfirmationWithNumberQuiz(title: string, message: string): Promise<boolean> {
    /**
     * This function presents a confirmation dialog with three buttons, each labeled with a random number.
     * The user must select the correct button to confirm the operation. The correct button is determined
     * by the `getRandomArrayAndIndex` function, which ensures that the correct button is never the first
     * button (position 0) that many operating systems select as the default when the dialog is displayed.
     *
     * ### Why this behavior is important:
     * - If the correct button were at position 0, users could accidentally confirm the operation by simply
     *   pressing "Enter" without carefully reading the dialog. This could lead to unintended confirmations
     *   and potentially destructive actions.
     * - By ensuring that the correct button is never the default, we add an extra layer of safety, requiring
     *   users to make an intentional choice to confirm the operation.
     *
     * ### Note to maintainers:
     * - The `getRandomArrayAndIndex` function is designed to exclude position 0 as the correct button.
     * - Any changes to this behavior should be carefully considered, as it directly impacts the user experience
     *   and the safety of confirmation dialogs.
     */
    const randomInput: { randomNumbers: number[]; randomPosition: number } = getRandomArrayAndIndex(3);

    const confirmation = await vscode.window.showWarningMessage(
        title,
        {
            modal: true,
            detail:
                message +
                '\n\n' +
                l10n.t('Pick "{number}" to confirm and continue.', {
                    number: randomInput.randomNumbers[randomInput.randomPosition],
                }),
        },
        randomInput.randomNumbers[0].toString(),
        randomInput.randomNumbers[1].toString(),
        randomInput.randomNumbers[2].toString(),
    );

    // Ensure that randomPosition is not 0 as a precaution.
    // This should not happen because getRandomArrayAndIndex is designed to always return a randomPosition > 0.
    // However, this check is added to avoid any potential mistakes or edge cases.
    if (randomInput.randomPosition === 0) {
        // and finally, in case the array is not large enough, we ensure that the random position is set to a valid index.
        randomInput.randomPosition = Math.min(1, randomInput.randomNumbers.length - 1);
    }

    return confirmation === randomInput.randomNumbers[randomInput.randomPosition].toString();
}

export async function getConfirmationWithClick(title: string, message: string): Promise<boolean> {
    const confirmation = await vscode.window.showWarningMessage(
        title,
        {
            modal: true,
            detail: message,
        },
        DialogResponses.yes,
    );

    return confirmation === DialogResponses.yes;
}

/**
 * Generates an array of random numbers and a random position (index) within the returned randomNumbers.
 * The random index will never point to position 0, ensuring that position 0 is not selected as the first, default position.
 * The provided length must be larger than 1.
 *
 * @param length - The length of the array to generate.
 * @returns An object containing the array of randomNumbers and a random position (index) within the array.
 */
function getRandomArrayAndIndex(length: number): { randomNumbers: number[]; randomPosition: number } {
    if (length <= 1) {
        throw new Error(l10n.t('Length must be greater than 1'));
    }

    // Generate an array of random numbers between 0 and 100 (can adjust range).
    // Note: Ensuring unique random numbers to avoid duplicates in the array.
    const randomNumbers: number[] = [];
    while (randomNumbers.length < length) {
        const randomNumber = Math.floor(Math.random() * 101);
        if (!randomNumbers.includes(randomNumber)) {
            randomNumbers.push(randomNumber);
        }
    }

    // Generate a random index that is always greater than 0.
    // Note to code maintainers: This behavior ensures that position 0 is never selected as the default.
    // Changing this behavior may break the UX where position 0 is intentionally excluded.
    const randomPosition: number = Math.floor(Math.random() * (randomNumbers.length - 1)) + 1;

    // Explanation: Math.random() generates a number between 0 (inclusive) and 1 (exclusive).
    // Multiplying by (randomNumbers.length - 1) ensures the range is [0, length-2].
    // Adding 1 shifts the range to [1, length-1], excluding 0.

    return { randomNumbers, randomPosition };
}
