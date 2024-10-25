/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import vscode from 'vscode';
import { ext } from '../extensionVariables';

export async function getConfirmationWithWarning(title: string, message: string): Promise<boolean> {
    const performQuiz: boolean | undefined = vscode.workspace
        .getConfiguration()
        .get<boolean>(ext.settingsKeys.requireAdditionalConfirmations);

    if (performQuiz) {
        const randomInput: { numbers: number[]; index: number } = getRandomArrayAndIndex(3);

        const confirmation = await vscode.window.showWarningMessage(
            title,
            {
                modal: true,
                detail:
                    message +
                    `\n\n` +
                    `Choose '${randomInput.numbers[randomInput.index]}' to confirm.\n\n` +
                    `(Planned: Adjust this safety check in the settings.)`,
            },
            randomInput.numbers[0].toString(),
            randomInput.numbers[1].toString(),
            randomInput.numbers[2].toString(),
        );

        return confirmation === randomInput.numbers[randomInput.index].toString();
    } else {
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
}

function getRandomArrayAndIndex(length: number): { numbers: number[]; index: number } {
    // Generate an array of three random numbers between 0 and 100 (can adjust range)
    const randomNumbers: number[] = Array.from({ length: length }, () => Math.floor(Math.random() * 101));

    const randomIndex: number = Math.floor(Math.random() * randomNumbers.length);

    return { numbers: randomNumbers, index: randomIndex };
}
