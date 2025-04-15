/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { InteractiveChildProcess } from '../../utils/InteractiveChildProcess';
import { wrapError } from '../../utils/wrapError';

// const mongoExecutableFileName = 'MongoAssessmentExtensionService.dll';

const sentinelRegex = /"?EXECUTION COMPLETED [0-9a-fA-F]{10}"?/;

export class MongoAssessmentServiceRunner extends vscode.Disposable {
    private constructor(private _process: InteractiveChildProcess) {
        super(() => this.dispose());
    }

    public static async createShellProcessHelper(
        execPath: string,
        execArgs: string[],
        outputChannel: vscode.OutputChannel,
    ): Promise<MongoAssessmentServiceRunner> {
        try {
            const args: string[] = execArgs.slice() || []; // Snapshot since we modify it

            const process: InteractiveChildProcess = await InteractiveChildProcess.create({
                outputChannel: outputChannel,
                command: execPath,
                args,
                outputFilterSearch: sentinelRegex,
                outputFilterReplace: '',
            });
            const shell: MongoAssessmentServiceRunner = new MongoAssessmentServiceRunner(process);
            ext.outputChannel.appendLine('Migration Assessment Server started.');
            return shell;
        } catch (error) {
            throw wrapCheckOutputWindow(error);
        }
    }

    public static async createShell(): Promise<MongoAssessmentServiceRunner> {
        //const config = vscode.workspace.getConfiguration();
        const mongoAssessmentServerPath: string | undefined = 'dotnet'; //C:\\code\\ads-extension-mongo-migration\\Product\\AdsMongoMigration\\bin\\service\\MongoAssessmentExtensionService.dll';
        const shellArgs: string[] = ['C:\\code\\ads-extension-mongo-migration\\Product\\AdsMongoMigration\\bin\\service\\MongoAssessmentExtensionService.dll']; // config.get(ext.settingsKeys.mongoShellArgs, []);

        return MongoAssessmentServiceRunner.createShellProcessHelper(
            mongoAssessmentServerPath,
            shellArgs,
            ext.outputChannel,
        );
    }

    public dispose(): void {
        this._process.kill();
    }
}

function wrapCheckOutputWindow(error: unknown): unknown {
    const checkOutputMsg = 'The output window may contain additional information.';
    return parseError(error).message.includes(checkOutputMsg) ? error : wrapError(error, checkOutputMsg);
}
