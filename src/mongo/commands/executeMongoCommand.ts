import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { executeCommandFromActiveEditor } from "../MongoScrapbook";
import { loadPersistedMongoDB } from "./connectMongoDatabase";

export async function executeMongoCommand(context: IActionContext, position?: vscode.Position): Promise<void> {
    await loadPersistedMongoDB();
    await executeCommandFromActiveEditor(context, position);
}
