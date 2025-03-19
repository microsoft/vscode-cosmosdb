/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type CreateContainerWizardContext } from './CreateContainerWizardContext';

const minThroughput: number = 400;
const maxThroughput: number = 100000;
const throughputStepSize = 100;

export class DocumentDBThroughputStep extends AzureWizardPromptStep<CreateContainerWizardContext> {
    public hideStepCount: boolean = false;

    public async prompt(context: CreateContainerWizardContext): Promise<void> {
        const prompt = l10n.t(
            "Initial throughput capacity, between {0} and {1} inclusive in increments of {2}. Enter 0 if the account doesn't support throughput.",
            minThroughput,
            maxThroughput,
            throughputStepSize,
        );

        context.throughput = Number(
            await context.ui.showInputBox({
                value: minThroughput.toString(),
                prompt,
                validateInput: (name: string) => this.validateInput(name),
            }),
        );

        context.valuesToMask.push(context.throughput.toString());
    }

    public shouldPrompt(context: CreateContainerWizardContext): boolean {
        return !context.accountInfo.isServerless;
    }

    public validateInput(throughput: string | undefined): string | undefined {
        throughput = throughput ? throughput.trim() : '';

        if (throughput === '0') {
            return undefined;
        }

        try {
            const value = Number(throughput);
            if (value < minThroughput || value > maxThroughput || (value - minThroughput) % throughputStepSize !== 0) {
                return l10n.t(
                    'Value must be between {0} and {1} in increments of {2}',
                    minThroughput,
                    maxThroughput,
                    throughputStepSize,
                );
            }
        } catch {
            return l10n.t('Input must be a number');
        }
        return undefined;
    }
}
