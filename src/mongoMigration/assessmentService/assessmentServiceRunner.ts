/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError, UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import * as cpUtils from '../../utils/cp';
import { InteractiveChildProcess } from '../../utils/InteractiveChildProcess';
import { wrapError } from '../../utils/wrapError';

const mongoExecutableFileName = 'MongoAssessmentExtensionService.dll';

const sentinelRegex = /"?EXECUTION COMPLETED [0-9a-fA-F]{10}"?/;


export class MongoAssessmentServiceRunner extends vscode.Disposable {

    private constructor(
        private _process: InteractiveChildProcess,
    ) {
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

    public static async createShell(
    ): Promise<MongoAssessmentServiceRunner> {
        const config = vscode.workspace.getConfiguration();
        const mongoAssessmentServerPath: string | undefined = 'dotnet C:\\code\\ads-extension-mongo-migration\\Product\\AdsMongoMigration\\bin\\service\\MongoAssessmentExtensionService.dll';
        const shellArgs: string[] = config.get(ext.settingsKeys.mongoShellArgs, []);

        return MongoAssessmentServiceRunner.createShellProcessHelper(
            mongoAssessmentServerPath,
            shellArgs,
            ext.outputChannel,
        );
    }

    public dispose(): void {
        this._process.kill();
    }

    private static async _determineShellPathOrCmd(
        context: IActionContext,
        shellPathSetting: string | undefined,
    ): Promise<string> {
        if (!shellPathSetting) {
            // User hasn't specified the path
            if (await cpUtils.commandSucceeds('mongo', '--version')) {
                // If the user already has mongo in their system path, just use that
                return 'mongo';
            } else {
                // If all else fails, prompt the user for the mongo path
                const openFile: vscode.MessageItem = { title: `Browse to ${mongoExecutableFileName}` };
                const browse: vscode.MessageItem = { title: 'Open installation page' };
                const noMongoError: string =
                    'This functionality requires the Mongo DB shell, but we could not find it in the path or using the mongo.shell.path setting.';
                const response = await context.ui.showWarningMessage(
                    noMongoError,
                    { stepName: 'promptForMongoPath' },
                    browse,
                    openFile,
                );
                if (response === openFile) {
                    // eslint-disable-next-line no-constant-condition
                    while (true) {
                        const newPath: vscode.Uri[] = await context.ui.showOpenDialog({
                            filters: { 'Executable Files': [process.platform === 'win32' ? 'exe' : ''] },
                            openLabel: `Select ${mongoExecutableFileName}`,
                            stepName: 'openMongoExeFile',
                        });
                        const fsPath = newPath[0].fsPath;
                        const baseName = path.basename(fsPath);
                        if (baseName !== mongoExecutableFileName) {
                            const useAnyway: vscode.MessageItem = { title: 'Use anyway' };
                            const tryAgain: vscode.MessageItem = { title: 'Try again' };
                            const response2 = await context.ui.showWarningMessage(
                                `Expected a file named "${mongoExecutableFileName}, but the selected filename is "${baseName}"`,
                                { stepName: 'confirmMongoExeFile' },
                                useAnyway,
                                tryAgain,
                            );
                            if (response2 === tryAgain) {
                                continue;
                            }
                        }

                        await vscode.workspace
                            .getConfiguration()
                            .update(ext.settingsKeys.mongoShellPath, fsPath, vscode.ConfigurationTarget.Global);
                        return fsPath;
                    }
                } else if (response === browse) {
                    void vscode.commands.executeCommand(
                        'vscode.open',
                        vscode.Uri.parse('https://docs.mongodb.com/manual/installation/'),
                    );
                    // default down to cancel error because MongoShell.create errors out if undefined is passed as the shellPath
                }

                throw new UserCancelledError('createShell');
            }
        } else {
            // User has specified the path or command.  Sometimes they set the folder instead of a path to the file, let's check that and auto fix
            if (await fse.pathExists(shellPathSetting)) {
                const stat = await fse.stat(shellPathSetting);
                if (stat.isDirectory()) {
                    return path.join(shellPathSetting, mongoExecutableFileName);
                }
            }

            return shellPathSetting;
        }
    }
}

function wrapCheckOutputWindow(error: unknown): unknown {
    const checkOutputMsg = 'The output window may contain additional information.';
    return parseError(error).message.includes(checkOutputMsg) ? error : wrapError(error, checkOutputMsg);
}
