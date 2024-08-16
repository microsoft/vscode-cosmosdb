import * as vscode from 'vscode';
import { type Command } from './Command';

export class ShowInformationMessageCommand implements Command<void> {
    constructor(private readonly message: string) {}

    public async execute(): Promise<void> {
        void vscode.window.showInformationMessage(this.message);
    }
}
