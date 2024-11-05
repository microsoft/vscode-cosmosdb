/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import vscode from 'vscode';
import { ext } from '../extensionVariables';

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
        prompt: `${message}\n\nPlease enter the word "${expectedConfirmationWord}" to confirm the operation.`,
        ignoreFocusOut: true,
        validateInput: (val: string | undefined) => {
            if (val && 0 === val.localeCompare(expectedConfirmationWord, undefined, { sensitivity: 'accent' })) {
                return undefined;
            }
            return `Please enter the word "${expectedConfirmationWord}" to confirm the operation.`;
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
            detail: message + `\n\nPick '${randomInput.numbers[randomInput.index]}' to confirm and continue.`,
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
        'Yes',
    );

    return confirmation === 'Yes';
}

function getRandomArrayAndIndex(length: number): { numbers: number[]; index: number } {
    // Generate an array of three random numbers between 0 and 100 (can adjust range)
    const randomNumbers: number[] = Array.from({ length: length }, () => Math.floor(Math.random() * 101));

    const randomIndex: number = Math.floor(Math.random() * randomNumbers.length);

    return { numbers: randomNumbers, index: randomIndex };
}
