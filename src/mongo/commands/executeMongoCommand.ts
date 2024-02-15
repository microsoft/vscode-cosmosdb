import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { executeCommandFromActiveEditor } from "../MongoScrapbook";
import { loadPersistedMongoDB } from "../registerMongoCommands";

export async function executeMongoCommand(context: IActionContext, position?: vscode.Position) {
    await loadPersistedMongoDB();
    await executeCommandFromActiveEditor(context, position);
}
