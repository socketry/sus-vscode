import * as assert from 'assert';
import * as vscode from 'vscode';
//import * as myExtension from '../extension';

test('lists tests', async () => {
	// Find the "Testing" activity bar icon and click it:
	await vscode.commands.executeCommand('workbench.view.extension.test');
	
	const extension = vscode.extensions.getExtension('socketry.sus-vscode');
	const projects = extension?.exports;
	const identifiers = Object.keys(projects);
	
	assert(identifiers.length > 0);
	
	identifiers.forEach(async (key) => {
		const project = projects[key];
		const workspace = project.workspaceFolder;
		
		assert(project);
		assert(project.controller);
		
		await project.controller.loadTree();
		
		assert(project.controller.items.size > 0);
	});
});
