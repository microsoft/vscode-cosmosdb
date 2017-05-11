import { TreeDataProvider, Command, Event, EventEmitter, Disposable } from 'vscode';
import { Model, Server, Database, IMongoResource } from './mongo';

export class MongoExplorer implements TreeDataProvider<IMongoResource> {

	private _disposables: Map<IMongoResource, Disposable[]> = new Map<IMongoResource, Disposable[]>();

	private _onChange: EventEmitter<IMongoResource> = new EventEmitter<IMongoResource>();
	readonly onChange: Event<IMongoResource> = this._onChange.event;

	constructor(private model: Model) {
		this.model.onChange(() => this._onChange.fire());
	}

	provideRootNode(): IMongoResource {
		return this.model;
	}

	getLabel(node: IMongoResource): string {
		return node.label;
	}

	getHasChildren(node: IMongoResource): boolean {
		return !!node.getChildren;
	}

	getClickCommand(node: IMongoResource): Command {
		return node.command;
	}

	getContextKey(node: IMongoResource): string {
		return node.contextKey;
	}

	resolveChildren(node: IMongoResource): Thenable<IMongoResource[]> {
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
				return new Disposable(() => { });
			}));
			return children;
		});
	}
}