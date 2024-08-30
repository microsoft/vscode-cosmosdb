import * as vscode from 'vscode';
import { type Command } from './Command';

export class ShowErrorMessageCommand implements Command<void> {
    constructor(private readonly message: string) {}

    public async execute() {
        void vscode.window.showErrorMessage(this.message);
    }
}
