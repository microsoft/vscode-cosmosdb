'use strict';

import * as vscode from 'vscode';
import { MongoExplorer } from './mongo/explorer';
import { MongoCommands, ResultDocument } from './mongo/commands';
import { Model } from './mongo/mongo';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {
	// Create the storage folder
	if (context.storagePath) {
		createStorageFolder(context).then(() => {
			const outputChannel = vscode.window.createOutputChannel('Mongo');
			const model = new Model({ extensionContext: context, outputChannel });
			const resultDocument = new ResultDocument(context);

			// Mongo explorer
			context.subscriptions.push(vscode.window.registerTreeExplorerNodeProvider('mongoExplorer', new MongoExplorer(model)));

			// Commands
			context.subscriptions.push(vscode.commands.registerCommand('mongo.addServer', () => { MongoCommands.addServer(model, context) }));
			context.subscriptions.push(vscode.commands.registerCommand('mongo.openShellEditor', node => { MongoCommands.openShell(node.element) }));
			context.subscriptions.push(vscode.commands.registerCommand('mongo.execute', () => MongoCommands.executeScript(model, resultDocument, outputChannel, true)));
			context.subscriptions.push(vscode.commands.registerCommand('mongo.executeLine', () => MongoCommands.executeScript(model, resultDocument, outputChannel, false)));
		});
	} else {
		context.subscriptions.push(vscode.window.registerTreeExplorerNodeProvider('mongoExplorer', {

			getLabel(): string {
				return '';
			},

			getHasChildren(): boolean {
				return false;
			},

			getClickCommand(): string {
				return '';
			},

			provideRootNode(): any {
				vscode.window.showInformationMessage('Open a workspace first.')
				return {};
			},

			resolveChildren(): Thenable<any[]> {
				return null;
			}
		}));
	}
}

async function createStorageFolder(context: vscode.ExtensionContext): Promise<void> {
	return new Promise<void>((c, e) => {
		fs.exists(context.storagePath, exists => {
			if (exists) {
				c(null);
			} else {
				fs.mkdir(context.storagePath, error => {
					c(null);
				})
			}
		});
	})
}

// this method is called when your extension is deactivated
export function deactivate() {
}