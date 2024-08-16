import * as vscode from 'vscode';
import { type Channel } from '../Communication/Channel/Channel';
import { type Command } from './Command';

export class OpenFileCommand implements Command<void> {
    public async execute(channel: Channel) {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Select',
            canSelectFiles: true,
            canSelectFolders: false,
            title: 'Select query',
            filters: {
                'Query files': ['sql', 'nosql'],
                'Text files': ['txt'],
            },
        };

        void vscode.window.showOpenDialog(options).then((fileUri) => {
            if (fileUri && fileUri[0]) {
                return vscode.workspace.openTextDocument(fileUri[0]).then((document) => {
                    void channel.postMessage({ type: 'event', name: 'fileOpened', params: [document.getText()] });
                });
            } else {
                return undefined;
            }
        });
    }
}
