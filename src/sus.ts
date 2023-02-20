import * as vscode from 'vscode';

import {Tree, Node, loadTreeFromPath} from './tree';
import {Tests, Runner} from './runner';

export class Project implements vscode.Disposable {
	workspaceFolder: vscode.WorkspaceFolder;
	controller: vscode.TestController;
	watcher: vscode.FileSystemWatcher | undefined;

	constructor(workspaceFolder: vscode.WorkspaceFolder, controller: vscode.TestController) {
		this.workspaceFolder = workspaceFolder;
		this.controller = controller;
	}

	dispose() {
		this.controller.dispose();
		this.watcher?.dispose();
	}

	addNodes(nodes: Node[], parent: vscode.TestItemCollection) {
		const added = [];

		for (const node of nodes) {
			added.push(this.addNode(node, parent));
		}

		return added;
	}

	addNode(node: Node, parent: vscode.TestItemCollection) {
		const parts = node.identity.split(':');
		const uri = vscode.Uri.joinPath(this.workspaceFolder.uri, parts[0]);
		const item = this.controller.createTestItem(node.identity, node.description, uri);

		if (parts.length > 1) {
			const lineNumber = parseInt(parts[parts.length - 1]);

			item.range = new vscode.Range(
				new vscode.Position(lineNumber - 1, 0),
				new vscode.Position(lineNumber, 0)
			);
		}

		parent.add(item);

		this.addNodes(node.children, item.children);

		return item;
	}

	async updateTree(tree: Tree, deletions: boolean) {
		// Don't add the root node as it's basically a place-holder.
		const added = this.addNodes(tree.root.children, this.controller.items);

		if (deletions) {
			const toDelete = new Set<string>();
			this.controller.items.forEach(item => toDelete.add(item.id));
			added.forEach(item => toDelete.delete(item.id));

			for (const id of toDelete) {
				this.controller.items.delete(id);
			}
		}
	}

	// Run all tests defined by the current controller.
	async runAllTests() {
		const testRun = this.controller.createTestRun(new vscode.TestRunRequest(), "Run all tests", false);
		const items = this.controller.items;
		const tests: Tests = {};

		function add(items: readonly vscode.TestItem[] | vscode.TestItemCollection) {
			items.forEach(item => {
				if (item.children.size > 0) add(item.children);
				else tests[item.id] = item;
			});
		}

		add(items);

		const runner = new Runner(testRun, this.workspaceFolder, tests, testRun.token);
		await runner.run();
	}

	async loadTree(deletions = false) {
		const tree = await loadTreeFromPath(this.workspaceFolder.uri.fsPath);
		this.updateTree(tree, deletions);
		this.runAllTests();
	}

	prepareWatcher() {
		const pattern = new vscode.RelativePattern(this.workspaceFolder, '**/*.rb');
		const watcher = vscode.workspace.createFileSystemWatcher(pattern);

		watcher.onDidCreate(uri => this.loadTree());
		watcher.onDidChange(uri => this.loadTree());
		watcher.onDidDelete(uri => this.loadTree(true));

		return watcher;
	}

	async runHandler(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
		const identifier = this.workspaceFolder.uri.toString();
		const testRun = this.controller.createTestRun(request, identifier, true);
		const items = request.include ?? this.controller.items;
		const tests: Tests = {};

		function add(items: readonly vscode.TestItem[] | vscode.TestItemCollection) {
			items.forEach(item => {
				if (item.children.size > 0) add(item.children);
				else tests[item.id] = item;
			});
		}

		add(items);

		function remove(items: readonly vscode.TestItem[] | vscode.TestItemCollection) {
			items.forEach(item => {
				delete tests[item.id];
				if (item.children) remove(item.children);
			});
		}

		if (request.exclude) {
			remove(request.exclude);
		}

		const runner = new Runner(testRun, this.workspaceFolder, tests, token);

		try {
			await runner.run();
		} finally {
			runner.dispose();
		}
	}

	resolveTree(test: vscode.TestItem | undefined) {
		this.loadTree();
	}

	async setup() {
		await this.loadTree();
		
		this.watcher = this.prepareWatcher();
		
		this.controller.refreshHandler = this.loadTree.bind(this, true);
		this.controller.resolveHandler = this.resolveTree.bind(this);
		this.controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, this.runHandler.bind(this), true, undefined);
		this.controller.createRunProfile('Coverage', vscode.TestRunProfileKind.Coverage, this.runHandler.bind(this), true, undefined);
	}
}
