import { TreeExplorerNodeProvider } from 'vscode';
import { Model, Server, Database, IMongoResource } from './mongo';

interface INode {
	element: IMongoResource;
}

export class MongoExplorer implements TreeExplorerNodeProvider<INode> {

	constructor(private model: Model) { }

	getLabel(node: INode): string {
		return node.element.id;
	}

	getHasChildren(node: INode): boolean {
		return node.element.hasChildren();
	}

	getClickCommand(node: INode): string {
		if (node.element instanceof Database) {
			return 'mongo.openShellEditor'
		}
		return '';
	}

	provideRootNode(): INode {
		if (this.model) {
			// TODO: dispose
		}
		return { element: this.model };
	}

	resolveChildren(node: INode): Thenable<INode[]> {
		return node.element.loadChildren().then(children => children.map(element => ({ element })));
	}
}