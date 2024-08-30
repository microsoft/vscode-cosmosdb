import { disconnectNoSqlContainer } from '../../docdb/commands/connectNoSqlContainer';
import { type Command } from './Command';

export class DisconnectFromDatabaseCommand implements Command {
    public async execute(): Promise<void> {
        return disconnectNoSqlContainer();
    }
}
