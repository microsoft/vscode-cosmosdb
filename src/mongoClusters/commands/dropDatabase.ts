import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { getConfirmationWithWarning } from '../../utils/dialogsConfirmations';
import { type DatabaseItem } from '../tree/DatabaseItem';

export async function dropDatabase(context: IActionContext, node?: DatabaseItem): Promise<void> {
    // node ??= ... pick a node if not provided
    if (!node) {
        throw new Error('No database selected.');
    }

    const confirmed = await getConfirmationWithWarning(
        'Are you sure?',
        `Drop database "${node?.databaseInfo.name}" and its contents?\nThis can't be undone.`,
    );

    if (!confirmed) {
        return;
    }

    await node.delete(context);
}
