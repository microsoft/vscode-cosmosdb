import * as vscode from 'vscode';
import { type Command } from './Command';

export class OpenFileCommand implements Command<string | undefined> {
    public async execute() {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Select',
            canSelectFiles: true,
            canSelectFolders: false,
            title: 'Select query',
            filters: {
                'Text files': ['txt'],
                'Query files': ['sql', 'nosql'],
            },
        };

        return vscode.window.showOpenDialog(options).then((fileUri) => {
            if (fileUri && fileUri[0]) {
                return vscode.workspace.openTextDocument(fileUri[0]).then((document) => {
                    return document.getText();
                });
            } else {
                return undefined;
            }
        });
    }
}
