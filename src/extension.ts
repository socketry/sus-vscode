import * as vscode from 'vscode';
import {loadTreeFromRoot, Node} from 'sus'

export async function activate(context: vscode.ExtensionContext) {
	const controller = vscode.tests.createTestController('susTestController', 'Sus Tests');
	context.subscriptions.push(controller);
	
	async function getWorkspaceTrees() {
		if (!vscode.workspace.workspaceFolders) {
			return [];
		}
		
		return vscode.workspace.workspaceFolders.map(workspaceFolder => ({
			workspaceFolder,
			tree: await loadTreeFromRoot(workspaceFolder.uri.fsPath),
		}));
	}
	
	async function updateTree(controller: vscode.TestController, workspaceFolder: vscode.WorkspaceFolder, tree: Node) {
		const root = controller.createTestItem('root', 'root', workspaceFolder.uri);
		root.children = [];
		controller.items.add(root);
		
		function addNode(node: Node, parent: vscode.TestItem) {
			const item = controller.createTestItem(node.identity, node.description, workspaceFolder.uri);
			parent.children.push(item);
			for (const child of node.children) {
				addNode(child, item);
			}
		}
		
		for (const child of tree.children) {
			addNode(child, root);
		}
	}
	
	async function startWatchingWorkspace(controller: vscode.TestController) {
		const workspaceTrees = await getWorkspaceTrees();
		
		return workspaceTrees.map(({workspaceFolder, tree}) => {
			const pattern = new vscode.RelativePattern(workspaceFolder, '**/*');
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);
		
			// watcher.onDidCreate(uri => getOrCreateFile(controller, uri));
			// watcher.onDidChange(uri => {
			// 	const { file, data } = getOrCreateFile(controller, uri);
			// 	if (data.didResolve) {
			// 		data.updateFromDisk(controller, file);
			// 	}
			// });
			// watcher.onDidDelete(uri => controller.items.delete(uri.toString()));
		
			updateTree(controller, workspaceFolder, tree);
		
			return watcher;
		});
	}
}