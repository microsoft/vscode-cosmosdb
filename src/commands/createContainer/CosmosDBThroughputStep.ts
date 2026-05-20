/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { API } from '../../AzureDBExperiences';
import { type CreateContainerWizardContext } from './CreateContainerWizardContext';

const minThroughput: number = 400;
const maxThroughput: number = 100_000;
const throughputStepSize = 100;

export class CosmosDBThroughputStep extends AzureWizardPromptStep<CreateContainerWizardContext> {
    public hideStepCount: boolean = false;

    public async prompt(context: CreateContainerWizardContext): Promise<void> {
        const prompt = l10n.t(
            'Initial throughput capacity, between {0} and {1} inclusive in increments of {2}.',
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
        if (context.accountInfo.isServerless) {
            context.throughput = 0;
            return false;
        }

        if (context.experience.api === API.FabricNative) {
            context.throughput = 0;
            context.maxThroughput = 5_000;
            return false;
        }

        return true;
    }

    public validateInput(throughput: string | undefined): string | undefined {
        throughput = throughput ? throughput.trim() : '';

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
