/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { range } from 'd3';
import * as fse from 'fs-extra';
import { json } from 'json';
import { Collection, Db, DbCollectionOptions } from 'mongodb';
import * as path from 'path';
import { QueryResult, QueryResultRow, ResultBuilder } from 'pg';
import { PoolClient } from 'pg';
import { Pool } from 'pg';
import pgStructure, { Table } from 'pg-structure';
import * as process from 'process';
import * as vscode from 'vscode';
import { appendExtensionUserAgent, AzureParentTreeItem, AzureTreeItem, DialogResponses, IActionContext, ICreateChildImplContext, UserCancelledError } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { ext } from '../../extensionVariables';
import { config } from '../config';
import { connectToPostgresClient } from '../connectToPostgresClient';
// import * as cpUtils from '../../utils/cp';
// import { getWorkspaceArrayConfiguration, getWorkspaceConfiguration } from '../../utils/getWorkspaceConfiguration';
// import { connectToMongoClient } from '../connectToMongoClient';
// import { MongoCommand } from '../MongoCommand';
// import { addDatabaseToAccountConnectionString } from '../mongoConnectionStrings';
// import { MongoShell } from '../MongoShell';
// import { IMongoTreeRoot } from './IMongoTreeRoot';
// import { MongoAccountTreeItem } from './MongoAccountTreeItem';
// import { MongoCollectionTreeItem } from './MongoCollectionTreeItem';
import { IPostgreSQLTreeRoot } from './IPostgreSQLTreeRoot';
import { PostgreSQLAccountTreeItem } from './PostgreSQLAccountTreeItem';
import { IPostgresTable, PostgreSQLTableTreeItem } from './PostgreSQLTableTreeItem';
// import { PostgreSQLTableTreeItem } from './PostgreSQLTableTreeItem';

// const mongoExecutableFileName = process.platform === 'win32' ? 'mongo.exe' : 'mongo';
// const executingInShellMsg = "Executing command in Mongo shell";

export class PostgreSQLDatabaseTreeItem extends AzureParentTreeItem<IPostgreSQLTreeRoot> {
    public static contextValue: string = "postgres";
    public readonly contextValue: string = PostgreSQLDatabaseTreeItem.contextValue;
    public readonly childTypeLabel: string = "Table";
    // public readonly connectionString: string;
    public readonly databaseName: string;
    public readonly parent: PostgreSQLAccountTreeItem;

    // private _previousShellPathSetting: string | undefined;
    // private _cachedShellPathOrCmd: string | undefined;

    constructor(parent: PostgreSQLAccountTreeItem, databaseName: string) {
        super(parent);
        this.databaseName = databaseName;
        const test = this.connectToDb();
        // this.connectionString = addDatabaseToAccountConnectionString(connectionString, this.databaseName);
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

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('Database.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<PostgreSQLTableTreeItem[]> {
        // if (clearCache || this.cursor === undefined) {
        //     this._cursor = this.collection.find(this._query).batchSize(defaultBatchSize);
        //     if (this._projection) {
        //         this._cursor = this._cursor.project(this._projection);
        //     }
        //     this._batchSize = defaultBatchSize;
        // }

        // const documents: IPostgresDocument[] = [];
        // let count: number = 0;
        // while (count < this._batchSize) {
        //     this._hasMoreChildren = await this._cursor.hasNext();
        //     if (this._hasMoreChildren) {
        //         documents.push(<IMongoDocument>await this._cursor.next());
        //         count += 1;
        //     } else {
        //         break;
        //     }
        // }
        // this._batchSize *= 2;

        const tables: IPostgresTable[] = [];

        const tableSet = await this.connectToDb();
        console.log(tableSet[0]);
        for (let i = 0; i < tableSet.length; i++) {
            tables.push(new IPostgresTable(tableSet[i]._table.oid, tableSet[i]._table.name, tableSet[i]._rows));
        }

        return tables.map((document: IPostgresTable) => new PostgreSQLTableTreeItem(this, document));
        // const tables = this.connectToDb();
        // let tableCollection = [];
        // for (let table in (await tables).keys()) {
        //     temp = new PostgreSQLTableTreeItem(this);
        //     tableCollection.push(temp);
        // }
        // return await tables.map(table => new PostgreSQLTableTreeItem(this, tables));
    }

    // // public async createChildImpl(context: ICreateChildImplContext): Promise<MongoCollectionTreeItem> {
    // //     const collectionName = await ext.ui.showInputBox({
    // //         placeHolder: "Collection Name",
    // //         prompt: "Enter the name of the collection",
    // //         validateInput: validateMongoCollectionName,
    // //         ignoreFocusOut: true
    // //     });

    // //     context.showCreatingTreeItem(collectionName);
    // //     return await this.createTable(collectionName);
    // // }

    // // public async deleteTreeItemImpl(): Promise<void> {
    // //     const message: string = `Are you sure you want to delete database '${this.label}'?`;
    // //     const result = await ext.ui.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
    // //     if (result === DialogResponses.deleteResponse) {
    // //         const db = await this.connectToDb();
    // //         await db.dropDatabase();
    // //     } else {
    // //         throw new UserCancelledError();
    // //     }
    // // }

    public async connectToDb(): Promise<QueryResultSet[]> {

        const postgresClient = await connectToPostgresClient();
        // const { Pool } = require('pg-pool');
        // const postgresClient = await connectToPostgresClient();
        // const pool = new Pool(postgresClient);

        const db = await pgStructure(config);

        const tables: Table[] = db.get("public").db.tables;
        console.log("Tables");
        console.log(tables);

        const { Pool } = require('pg');
        const pool = new Pool(config);

        const resultSet: QueryResultSet[] = [];

        for (let i = 0; i < tables.length; i++) {
            const query = 'SELECT * FROM ' + tables[i].name + ';';
            const result = [];
            (async () => {
                const client = await pool.connect();
                try {
                    const res = await client.query(query);
                    const rows = res.rows;

                    rows.map(row => {
                        result.push(row);
                    });

                    console.log(res.rows[0], i);
                } finally {
                    // Make sure to release the client before any error handling,
                    // just in case the error handling itself throws an error.
                    client.release();
                }
            })().catch(err => console.log(err.stack));
            resultSet.push(new QueryResultSet(tables[i], result));
            // pool
            //     .query('SELECT * FROM inventory;')
            //     .then(res => console.log('user:', res.rows[0], i))
            //     .catch(err =>
            //         setImmediate(() => {
            //             throw err;
            //         })
            //     );
        }



        return resultSet;
    }

    // public async connectToDb(): Promise<QueryResultSet[]> {

    //     pool.query('SELECT * FROM inventory;', [1], (err, res) => {
    //         if (err) {
    //             throw err;
    //         }

    //         console.log("read: ", res.rows[0]);
    //     });
    //     // const postgresClient = await connectToPostgresClient();
    //     // const query = 'SELECT * FROM inventory;';
    //     // postgresClient.query(query)
    //     //     .then(res => {
    //     //         const rows = res.rows;

    //     //         rows.map(row => {
    //     //             console.log(`Read: ${JSON.stringify(row)}`);
    //     //         });

    //     //         process.exit();
    //     //     })
    //     //     .catch(err => {
    //     //         console.log(err);
    //     //     });

    //     const resultSet: QueryResultSet[] = [];

    //     // const query = 'SELECT * FROM inventory;';
    //     // postgresClient.query(query)
    //     //     .then(res => {
    //     //         const rows = res.rows;

    //     //         rows.map(row => {
    //     //             console.log(`Read: ${JSON.stringify(row)}`);
    //     //         });

    //     //         process.exit();
    //     //     })
    //     //     .catch(err => {
    //     //         console.log(err);
    //     //     });

    //     // for (let i = 0; i < tables.length; i++) {
    //     //     const query = 'SELECT * FROM inventory;';
    //     //     // postgresClient = await connectToPostgresClient();
    //     //     postgresClient.query(query)
    //     //         .then(res => {
    //     //             const rows = res.rows;

    //     //             rows.map(row => {
    //     //                 console.log(`Read: ${JSON.stringify(row)}`);
    //     //             });
    //     //             postgresClient.end();
    //     //         })
    //     //         .catch(err => {
    //     //             console.log(err);
    //     //         });
    //     //     // postgresClient = await connectToPostgresClient();

    //     //     // const query = 'SELECT * FROM ' + tables[i].name + "; ";

    //     //     // console.log(query);

    //     //     // const result: any[] = [];

    //     //     // postgresClient.query(query)
    //     //     //     .then(res => {
    //     //     //         const rows = res.rows;

    //     //     //         // console.log(rows);
    //     //     //         // let dictString = JSON.stringify(rows);

    //     //     //         // let fs = require('fs');
    //     //     //         // fs.writeFile("test.json", dictString);
    //     //     //         // const fs = require('fs');
    //     //     //         // const logStream = fs.createWriteStream('test.json', { flags: 'a' });

    //     //     //         rows.map(row => {
    //     //     //             // console.log(row);
    //     //     //             // logStream.write(JSON.stringify(row));
    //     //     //             console.log("Postgres");
    //     //     //             console.log(row);
    //     //     //             result.push(row);

    //     //     //         });

    //     //     //         resultSet.push(new QueryResultSet(tables[i], result));

    //     //     //         // process.exit();
    //     //     //     })
    //     //     //     .catch(err => {
    //     //     //         console.log(err);
    //     //     //     });

    //     //     console.log("Tables");
    //     // }

    //     // console.log(db.get("public").db.tables[0].oid);

    //     return resultSet;
    // }

    // public async executeCommand(command: MongoCommand, context: IActionContext): Promise<string> {
    //     if (command.collection) {
    //         const db = await this.connectToDb();
    //         const collection = db.collection(command.collection);
    //         if (collection) {
    //             const collectionTreeItem = new MongoCollectionTreeItem(this, collection, command.arguments);
    //             const result = await collectionTreeItem.tryExecuteCommandDirectly(command);
    //             if (!result.deferToShell) {
    //                 return result.result;
    //             }
    //         }
    //         return withProgress(this.executeCommandInShell(command, context), executingInShellMsg);

    //     }

    //     if (command.name === 'createCollection') {
    //         // arguments  are all strings so DbCollectionOptions is represented as a JSON string which is why we pass argumentObjects instead
    //         return withProgress(this.createCollection(stripQuotes(command.arguments[0]), command.argumentObjects[1]).then(() => JSON.stringify({ Created: 'Ok' })), 'Creating collection');
    //     } else {
    //         return withProgress(this.executeCommandInShell(command, context), executingInShellMsg);
    //     }
    // }

    // public async createTable(collectionName: string): Promise<PostgreSQLTableTreeItem> {
    //     const db = await this.connectToDb();
    //     const newTable = await db.createCollection(collectionName);
    //     // db.createCollection() doesn't create empty collections for some reason
    //     // However, we can 'insert' and then 'delete' a document, which has the side-effect of creating an empty collection

    //     return new PostgreSQLTableTreeItem(this, newTable);
    // }

    // private async executeCommandInShell(command: MongoCommand, context: IActionContext): Promise<string> {
    //     context.telemetry.properties.executeInShell = "true";

    //     // CONSIDER: Re-using the shell instead of disposing it each time would allow us to keep state
    //     //  (JavaScript variables, etc.), but we would need to deal with concurrent requests, or timed-out
    //     //  requests.
    //     const shell = await this.createShell();
    //     try {
    //         await shell.useDatabase(this.databaseName);
    //         return await shell.executeScript(command.text);
    //     } finally {
    //         shell.dispose();
    //     }
    // }

    // private async createShell(): Promise<MongoShell> {
    //     let shellPath: string | undefined = getWorkspaceConfiguration(ext.settingsKeys.mongoShellPath, "string");
    //     const shellArgs: string[] = getWorkspaceArrayConfiguration(ext.settingsKeys.mongoShellArgs, "string", []);

    //     if (!this._cachedShellPathOrCmd || this._previousShellPathSetting !== shellPath) {
    //         // Only do this if setting changed since last time
    //         shellPath = await this._determineShellPathOrCmd(shellPath);
    //         this._previousShellPathSetting = shellPath;
    //     }
    //     this._cachedShellPathOrCmd = shellPath;

    //     const timeout = 1000 * vscode.workspace.getConfiguration().get<number>(ext.settingsKeys.mongoShellTimeout);
    //     return MongoShell.create(shellPath, shellArgs, this.connectionString, this.root.isEmulator, ext.outputChannel, timeout);
    // }

    // private async _determineShellPathOrCmd(shellPathSetting: string): Promise<string> {
    //     if (!shellPathSetting) {
    //         // User hasn't specified the path
    //         if (await cpUtils.commandSucceeds('mongo', '--version')) {
    //             // If the user already has mongo in their system path, just use that
    //             return 'mongo';
    //         } else {
    //             // If all else fails, prompt the user for the mongo path

    //             // tslint:disable-next-line:no-constant-condition
    //             const openFile: vscode.MessageItem = { title: `Browse to ${mongoExecutableFileName}` };
    //             const browse: vscode.MessageItem = { title: 'Open installation page' };
    //             const noMongoError: string = 'This functionality requires the Mongo DB shell, but we could not find it in the path or using the mongo.shell.path setting.';
    //             const response = await vscode.window.showErrorMessage(noMongoError, browse, openFile);
    //             if (response === openFile) {
    //                 // tslint:disable-next-line:no-constant-condition
    //                 while (true) {
    //                     const newPath: vscode.Uri[] = await vscode.window.showOpenDialog({
    //                         filters: { 'Executable Files': [process.platform === 'win32' ? 'exe' : ''] },
    //                         openLabel: `Select ${mongoExecutableFileName}`
    //                     });
    //                     if (newPath && newPath.length) {
    //                         const fsPath = newPath[0].fsPath;
    //                         const baseName = path.basename(fsPath);
    //                         if (baseName !== mongoExecutableFileName) {
    //                             const useAnyway: vscode.MessageItem = { title: 'Use anyway' };
    //                             const tryAgain: vscode.MessageItem = { title: 'Try again' };
    //                             const response2 = await ext.ui.showWarningMessage(
    //                                 `Expected a file named "${mongoExecutableFileName}, but the selected filename is "${baseName}"`,
    //                                 useAnyway,
    //                                 tryAgain);
    //                             if (response2 === tryAgain) {
    //                                 continue;
    //                             }
    //                         }

    //                         await vscode.workspace.getConfiguration().update(ext.settingsKeys.mongoShellPath, fsPath, vscode.ConfigurationTarget.Global);
    //                         return fsPath;
    //                     } else {
    //                         throw new UserCancelledError();
    //                     }
    //                 }
    //             } else if (response === browse) {
    //                 vscode.commands.executeCommand('vscode.open', vscode.Uri.parse('https://docs.mongodb.com/manual/installation/'));
    //                 // default down to cancel error because MongoShell.create errors out if undefined is passed as the shellPath
    //             }

    //             throw new UserCancelledError();
    //         }
    //     } else {
    //         // User has specified the path or command.  Sometimes they set the folder instead of a path to the file, let's check that and auto fix
    //         if (await fse.pathExists(shellPathSetting)) {
    //             const stat = await fse.stat(shellPathSetting);
    //             if (stat.isDirectory()) {
    //                 return path.join(shellPathSetting, mongoExecutableFileName);
    //             }
    //         }

    //         return shellPathSetting;
    //     }
    // }
}

// export function validateMongoCollectionName(collectionName: string): string | undefined | null {
//     // https://docs.mongodb.com/manual/reference/limits/#Restriction-on-Collection-Names
//     if (!collectionName) {
//         return "Collection name cannot be empty";
//     }
//     const systemPrefix = "system.";
//     if (collectionName.startsWith(systemPrefix)) {
//         return `"${systemPrefix}" prefix is reserved for internal use`;
//     }
//     if (/[$]/.test(collectionName)) {
//         return "Collection name cannot contain $";
//     }
//     return undefined;
// }

// function withProgress<T>(promise: Thenable<T>, title: string, location = vscode.ProgressLocation.Window): Thenable<T> {
//     return vscode.window.withProgress<T>(
//         {
//             location: location,
//             title: title
//         },
//         (_progress) => {
//             return promise;
//         });
// }

// export function stripQuotes(term: string): string {
//     if ((term.startsWith('\'') && term.endsWith('\''))
//         || (term.startsWith('"') && term.endsWith('"'))) {
//         return term.substring(1, term.length - 1);
//     }
//     return term;
// }

export class QueryResultSet {
    public _table: Table;
    public _rows: any[];
    constructor(table, rows) {
        this._table = table;
        this._rows = rows;
    }
}
