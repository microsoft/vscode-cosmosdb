import { TreeExplorerNodeProvider, TreeNode, Command, Event, EventEmitter, Disposable } from 'vscode';
import { Model, Server, Database } from './mongo';

export class MongoExplorer implements TreeExplorerNodeProvider<TreeNode> {

	private _disposables: Map<TreeNode, Disposable[]> = new Map<TreeNode, Disposable[]>();

	private _onChange: EventEmitter<TreeNode> = new EventEmitter<TreeNode>();
	readonly onChange: Event<TreeNode> = this._onChange.event;

	constructor(private model: Model) {
		this.model.onChange(() => this._onChange.fire());
	 }

	provideRootNode(): TreeNode {
		return this.model;
	}

	getLabel(node: TreeNode): string {
		return node.label;
	}

	getHasChildren(node: TreeNode): boolean {
		return !!node.getChildren;
	}

	getClickCommand(node: TreeNode): Command {
		return node.command;
	}

	resolveChildren(node: TreeNode): Thenable<TreeNode[]> {
		const disposables = this._disposables.get(node);
		if (disposables) {
			for (const disposable of disposables) {
				disposable.dispose();
			}
		}
		return node.getChildren().then(children => {
			this._disposables.set(node, children.map(child => {
				if (child.onChange) {
					return child.onChange(() => this._onChange.fire(child));
				}
				return new Disposable(() => {});
			}));
			return children;
		});
	}
}