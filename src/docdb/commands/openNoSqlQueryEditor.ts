import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { QueryEditorTab } from '../../panels/QueryEditorTab';
import { type DocDBCollectionTreeItem } from '../tree/DocDBCollectionTreeItem';
import { createNoSqlQueryConnection } from './connectNoSqlContainer';

export const openNoSqlQueryEditor = (_context: IActionContext, node?: DocDBCollectionTreeItem) => {
    const connection = node ? createNoSqlQueryConnection(node) : undefined;

    QueryEditorTab.render(connection);
};
