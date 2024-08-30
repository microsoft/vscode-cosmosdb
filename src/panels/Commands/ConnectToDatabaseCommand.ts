import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { connectNoSqlContainer } from '../../docdb/commands/connectNoSqlContainer';
import { type Command } from './Command';

export class ConnectToDatabaseCommand implements Command {
    public async execute(): Promise<void> {
        void callWithTelemetryAndErrorHandling<void>('cosmosDB.connectToDatabase', (context) =>
            connectNoSqlContainer(context),
        );
    }
}
