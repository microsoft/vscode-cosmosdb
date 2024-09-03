import  { type IActionContext } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';
import { executeCommandFromActiveEditor } from '../MongoScrapbook';
import { loadPersistedMongoDB } from './connectMongoDatabase';

export async function executeMongoCommand(context: IActionContext, position?: vscode.Position) {
    await loadPersistedMongoDB();
    await executeCommandFromActiveEditor(context, position);
}
