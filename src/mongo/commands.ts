/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as vscode from 'vscode';
import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { ANTLRInputStream as InputStream } from 'antlr4ts/ANTLRInputStream';
import { CommonTokenStream } from 'antlr4ts/CommonTokenStream';
import { MongoDatabaseNode, MongoCommand, MongoDocumentNode, MongoCollectionNode } from './nodes';
import { CosmosDBExplorer } from '../explorer';
import * as fs from 'fs';
import * as mongoParser from './grammar/mongoParser';
import { MongoVisitor } from './grammar/visitors';
import { mongoLexer } from './grammar/mongoLexer';
import * as util from './../util';
import { DialogBoxResponses } from '../constants'
import { DocumentEditor } from '../DocumentEditor';

export class MongoCommands {

	public static async executeCommandFromActiveEditor(database: MongoDatabaseNode, extensionPath, editor: DocumentEditor): Promise<MongoCommand> {
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor.document.languageId !== 'mongo') {
			return;
		}
		const selection = activeEditor.selection;
		const command = MongoCommands.getCommand(activeEditor.document.getText(), selection.start);
		if (command) {
			if (!database) {
				throw new Error('Please connect to the database first');
			}
			if (command.name === 'find') {
				const db = await database.getDb();
				let node = new MongoCollectionNode(db.collection(command.collection), database, command.arguments);
				await node.getChildren();
				await editor.showDocument(node);
				return command;
			}
			const result = await database.executeCommand(command);
			const parsed = JSON.parse(result);
			if (command.name === 'findOne') {
				const db = await database.getDb();
				let node = new MongoDocumentNode(parsed._id, null, parsed);
				await editor.showDocument(node);
			}
			else {
				await util.showNewFile(result, extensionPath, 'result', '.json', activeEditor.viewColumn + 1);
			}
		} else {
			throw new Error('No executable command found.');
		}

		return command;
	}

	public static getCommand(content: string, position?: vscode.Position): MongoCommand {
		const lexer = new mongoLexer(new InputStream(content));
		lexer.removeErrorListeners();
		const parser = new mongoParser.mongoParser(new CommonTokenStream(lexer));
		parser.removeErrorListeners();

		const commands = new MongoScriptDocumentVisitor().visit(parser.commands());
		let lastCommandOnSameLine = null;
		let lastCommandBeforePosition = null;
		if (position) {
			for (const command of commands) {
				if (command.range.contains(position)) {
					return command;
				}
				if (command.range.end.line === position.line) {
					lastCommandOnSameLine = command;
				}
				if (command.range.end.isBefore(position)) {
					lastCommandBeforePosition = command;
				}
			}
		}
		return lastCommandOnSameLine || lastCommandBeforePosition || commands[commands.length - 1];
	}

	public static async createMongoCollection(db: MongoDatabaseNode, explorer: CosmosDBExplorer) {
		const collectionName = await vscode.window.showInputBox({
			placeHolder: "Enter name of collection",
			ignoreFocusOut: true
		});
		if (collectionName) {
			await db.createCollection(collectionName);
			explorer.refresh(db);
		}
	}

	public static async deleteMongoCollection(collectionNode: MongoCollectionNode, explorer: CosmosDBExplorer) {
		const confirmed = await vscode.window.showWarningMessage(`Are you sure you want to delete collection '${collectionNode.label}'?`, DialogBoxResponses.Yes);
		if (confirmed === DialogBoxResponses.Yes) {
			const db = collectionNode.db;
			db.dropCollection(collectionNode.id);
			explorer.refresh(collectionNode.db);
		}
	}

	public static async createMongoDocument(collectionNode: MongoCollectionNode, explorer: CosmosDBExplorer) {
		const docId = await vscode.window.showInputBox({
			placeHolder: "Enter a unique id for the document.",
			ignoreFocusOut: true
		});

		if (docId !== undefined) {
			const result = await collectionNode.collection.insertOne(docId === '' ? {} : { "id": docId });
			const newDoc = await collectionNode.collection.findOne({ _id: result.insertedId });
			collectionNode.addNewDocToCache(newDoc);
			explorer.refresh(collectionNode);
		}
	}

	public static async deleteMongoDocument(documentNode: MongoDocumentNode, explorer: CosmosDBExplorer) {
		const confirmed = await vscode.window.showWarningMessage(`Are you sure you want to delete collection '${documentNode.label}'?`, DialogBoxResponses.Yes);
		if (confirmed === DialogBoxResponses.Yes) {
			const coll = documentNode.collection;
			await coll.collection.deleteOne({ "_id": documentNode.id });
			documentNode.collection.removeNodeFromCache(documentNode);
			explorer.refresh(documentNode.collection);
		}
	}

}

export class MongoScriptDocumentVisitor extends MongoVisitor<MongoCommand[]> {

	private commands: MongoCommand[] = [];

	visitCommand(ctx: mongoParser.CommandContext): MongoCommand[] {
		this.commands.push({
			range: new vscode.Range(ctx.start.line - 1, ctx.start.charPositionInLine, ctx.stop.line - 1, ctx.stop.charPositionInLine),
			text: ctx.text,
			name: ''
		});
		return super.visitCommand(ctx);
	}

	visitCollection(ctx: mongoParser.CollectionContext): MongoCommand[] {
		this.commands[this.commands.length - 1].collection = ctx.text;
		return super.visitCollection(ctx);
	}

	visitFunctionCall(ctx: mongoParser.FunctionCallContext): MongoCommand[] {
		if (ctx.parent instanceof mongoParser.CommandContext) {
			this.commands[this.commands.length - 1].name = ctx._FUNCTION_NAME.text;
		}
		return super.visitFunctionCall(ctx);
	}

	visitArgumentList(ctx: mongoParser.ArgumentListContext): MongoCommand[] {
		let argumentsContext = ctx.parent;
		if (argumentsContext) {
			let functionCallContext = argumentsContext.parent;
			if (functionCallContext && functionCallContext.parent instanceof mongoParser.CommandContext) {
				this.commands[this.commands.length - 1].arguments = ctx.text;
			}
		}
		return super.visitArgumentList(ctx);
	}

	protected defaultResult(node: ParseTree): MongoCommand[] {
		return this.commands;
	}
}

