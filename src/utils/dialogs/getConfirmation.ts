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
    const randomInput: { numbers: number[]; index: number } = getRandomArrayAndIndex(3);

    const confirmation = await vscode.window.showWarningMessage(
        title,
        {
            modal: true,
            detail:
                message +
                '\n\n' +
                l10n.t('Pick "{number}" to confirm and continue.', { number: randomInput.numbers[randomInput.index] }),
        },
        randomInput.numbers[0].toString(),
        randomInput.numbers[1].toString(),
        randomInput.numbers[2].toString(),
    );

    return confirmation === randomInput.numbers[randomInput.index].toString();
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
 * Generates an array of random numbers and a random index that is always greater than 0.
 * The provided length must be larger than 1.
 *
 * @param length - The length of the array to generate.
 * @returns An object containing the array of random numbers and a random index greater than 0.
 */
function getRandomArrayAndIndex(length: number): { numbers: number[]; index: number } {
    if (length <= 1) {
        throw new Error(l10n.t('Length must be greater than 1'));
    }

    // Generate an array of random numbers between 0 and 100 (can adjust range).
    // Why the loop below? Well, we want to ensure that these random numbers are unique,
    // and it did seem unlikely that we would get a duplicate number in a small array
    // but I actually got a duplicate number in a 3 element array on the second try
    const randomNumbers: number[] = [];
    while (randomNumbers.length < length) {
        const randomNumber = Math.floor(Math.random() * 101);
        if (!randomNumbers.includes(randomNumber)) {
            randomNumbers.push(randomNumber);
        }
    }

    // Ensure the random index is always greater than 0
    const randomIndex: number = Math.floor(Math.random() * (randomNumbers.length - 1)) + 1;

    return { numbers: randomNumbers, index: randomIndex };
}
