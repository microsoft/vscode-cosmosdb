import * as vscodeUtil from '../../utils/vscodeUtils';
import { type Command } from './Command';

export class SaveFileCommand implements Command<void> {
    constructor(private readonly query: string) {}
    public async execute() {
        await vscodeUtil.showNewFile(this.query, `New query`, '.nosql');
    }
}
