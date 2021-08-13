/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fse from 'fs-extra';
import { Collection, Db, DbCollectionOptions } from 'mongodb';
import * as path from 'path';
import * as process from 'process';
import * as vscode from 'vscode';
import { appendExtensionUserAgent, AzExtParentTreeItem, DialogResponses, IActionContext, ICreateChildImplContext, TreeItemIconPath, UserCancelledError } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import * as cpUtils from '../../utils/cp';
import { nonNullProp, nonNullValue } from '../../utils/nonNull';
import { connectToMongoClient } from '../connectToMongoClient';
import { MongoCommand } from '../MongoCommand';
import { addDatabaseToAccountConnectionString } from '../mongoConnectionStrings';
import { MongoShell } from '../MongoShell';
import { IMongoTreeRoot } from './IMongoTreeRoot';
import { MongoAccountTreeItem } from './MongoAccountTreeItem';
import { MongoCollectionTreeItem } from './MongoCollectionTreeItem';

const mongoExecutableFileName = process.platform === 'win32' ? 'mongo.exe' : 'mongo';
const executingInShellMsg = "Executing command in Mongo shell";

export class MongoDatabaseTreeItem extends AzExtParentTreeItem {
    public static contextValue: string = "mongoDb";
    public readonly contextValue: string = MongoDatabaseTreeItem.contextValue;
    public readonly childTypeLabel: string = "Collection";
    public readonly connectionString: string;
    public readonly databaseName: string;
    public readonly parent: MongoAccountTreeItem;

    private _previousShellPathSetting: string | undefined;
    private _cachedShellPathOrCmd: string | undefined;

    constructor(parent: MongoAccountTreeItem, databaseName: string, connectionString: string) {
        super(parent);
        this.databaseName = databaseName;
        this.connectionString = addDatabaseToAccountConnectionString(connectionString, this.databaseName);
    }

    public get root(): IMongoTreeRoot {
        return this.parent.root;
    }

    public get label(): string {
        return this.databaseName;
    }

    public get description(): string {
        return ext.connectedMongoDB && ext.connectedMongoDB.fullId === this.fullId ? 'Connected' : '';
    }

    public get id(): string {
        return this.databaseName;
    }

    public get iconPath(): TreeItemIconPath {
        return new vscode.ThemeIcon('database');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<MongoCollectionTreeItem[]> {
        const db: Db = await this.connectToDb();
        const collections: Collection[] = await db.collections();
        return collections.map(collection => new MongoCollectionTreeItem(this, collection));
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<MongoCollectionTreeItem> {
        const collectionName = await context.ui.showInputBox({
            placeHolder: "Collection Name",
            prompt: "Enter the name of the collection",
            stepName: 'createMongoCollection',
            validateInput: validateMongoCollectionName
        });

        context.showCreatingTreeItem(collectionName);
        return await this.createCollection(collectionName);
    }

    public async deleteTreeItemImpl(context: IActionContext): Promise<void> {
        const message: string = `Are you sure you want to delete database '${this.label}'?`;
        await context.ui.showWarningMessage(message, { modal: true, stepName: 'deleteMongoDatabase' }, DialogResponses.deleteResponse);
        const db = await this.connectToDb();
        await db.dropDatabase();
    }

    public async connectToDb(): Promise<Db> {
        const accountConnection = await connectToMongoClient(this.connectionString, appendExtensionUserAgent());
        return accountConnection.db(this.databaseName);
    }

    public async executeCommand(command: MongoCommand, context: IActionContext): Promise<string> {
        if (command.collection) {
            const db = await this.connectToDb();
            const collection = db.collection(command.collection);
            if (collection) {
                const collectionTreeItem = new MongoCollectionTreeItem(this, collection, command.arguments);
                const result = await collectionTreeItem.tryExecuteCommandDirectly(command);
                if (!result.deferToShell) {
                    return result.result;
                }
            }
            return withProgress(this.executeCommandInShell(command, context), executingInShellMsg);

        }

        if (command.name === 'createCollection') {
            // arguments  are all strings so DbCollectionOptions is represented as a JSON string which is why we pass argumentObjects instead
            return withProgress(this.createCollection(stripQuotes(nonNullProp(command, 'arguments')[0]), nonNullProp(command, 'argumentObjects')[1]).then(() => JSON.stringify({ Created: 'Ok' })), 'Creating collection');
        } else {
            return withProgress(this.executeCommandInShell(command, context), executingInShellMsg);
        }
    }

    public async createCollection(collectionName: string, options?: DbCollectionOptions): Promise<MongoCollectionTreeItem> {
        const db: Db = await this.connectToDb();
        const newCollection: Collection = await db.createCollection(collectionName, options);
        // db.createCollection() doesn't create empty collections for some reason
        // However, we can 'insert' and then 'delete' a document, which has the side-effect of creating an empty collection
        const result = await newCollection.insertOne({});
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        await newCollection.deleteOne({ _id: result.insertedId });
        return new MongoCollectionTreeItem(this, newCollection);
    }

    private async executeCommandInShell(command: MongoCommand, context: IActionContext): Promise<string> {
        context.telemetry.properties.executeInShell = "true";

        if (this.root.isEmulator) {
            // Ensure the emulator is running before creating the shell. Shell errors are generic and don't include emulator specific info
            await this.connectToDb();
        }

        // CONSIDER: Re-using the shell instead of disposing it each time would allow us to keep state
        //  (JavaScript variables, etc.), but we would need to deal with concurrent requests, or timed-out
        //  requests.
        const shell = await this.createShell(context);
        try {
            await shell.useDatabase(this.databaseName);
            return await shell.executeScript(command.text);
        } finally {
            shell.dispose();
        }
    }

    private async createShell(context: IActionContext): Promise<MongoShell> {
        const config = vscode.workspace.getConfiguration();
        let shellPath: string | undefined = config.get(ext.settingsKeys.mongoShellPath);
        const shellArgs: string[] = config.get(ext.settingsKeys.mongoShellArgs, []);

        if (!shellPath || !this._cachedShellPathOrCmd || this._previousShellPathSetting !== shellPath) {
            // Only do this if setting changed since last time
            shellPath = await this._determineShellPathOrCmd(context, shellPath);
            this._previousShellPathSetting = shellPath;
        }
        this._cachedShellPathOrCmd = shellPath;

        const timeout = 1000 * nonNullValue(config.get<number>(ext.settingsKeys.mongoShellTimeout), 'mongoShellTimeout');
        return MongoShell.create(shellPath, shellArgs, this.connectionString, this.root.isEmulator, ext.outputChannel, timeout);
    }

    private async _determineShellPathOrCmd(context: IActionContext, shellPathSetting: string | undefined): Promise<string> {
        if (!shellPathSetting) {
            // User hasn't specified the path
            if (await cpUtils.commandSucceeds('mongo', '--version')) {
                // If the user already has mongo in their system path, just use that
                return 'mongo';
            } else {
                // If all else fails, prompt the user for the mongo path
                const openFile: vscode.MessageItem = { title: `Browse to ${mongoExecutableFileName}` };
                const browse: vscode.MessageItem = { title: 'Open installation page' };
                const noMongoError: string = 'This functionality requires the Mongo DB shell, but we could not find it in the path or using the mongo.shell.path setting.';
                const response = await context.ui.showWarningMessage(noMongoError, { stepName: 'promptForMongoPath' }, browse, openFile);
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
                                tryAgain);
                            if (response2 === tryAgain) {
                                continue;
                            }
                        }

                        await vscode.workspace.getConfiguration().update(ext.settingsKeys.mongoShellPath, fsPath, vscode.ConfigurationTarget.Global);
                        return fsPath;
                    }
                } else if (response === browse) {
                    void vscode.commands.executeCommand('vscode.open', vscode.Uri.parse('https://docs.mongodb.com/manual/installation/'));
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

export function validateMongoCollectionName(collectionName: string): string | undefined | null {
    // https://docs.mongodb.com/manual/reference/limits/#Restriction-on-Collection-Names
    if (!collectionName) {
        return "Collection name cannot be empty";
    }
    const systemPrefix = "system.";
    if (collectionName.startsWith(systemPrefix)) {
        return `"${systemPrefix}" prefix is reserved for internal use`;
    }
    if (/[$]/.test(collectionName)) {
        return "Collection name cannot contain $";
    }
    return undefined;
}

function withProgress<T>(promise: Thenable<T>, title: string, location: vscode.ProgressLocation = vscode.ProgressLocation.Window): Thenable<T> {
    return vscode.window.withProgress<T>(
        {
            location: location,
            title: title
        },
        (_progress) => {
            return promise;
        });
}

export function stripQuotes(term: string): string {
    if ((term.startsWith('\'') && term.endsWith('\''))
        || (term.startsWith('"') && term.endsWith('"'))) {
        return term.substring(1, term.length - 1);
    }
    return term;
}
