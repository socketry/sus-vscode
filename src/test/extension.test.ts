import * as assert from 'assert';
import * as vscode from 'vscode';
//import * as myExtension from '../extension';

test('lists tests', async () => {
	// Find the "Testing" activity bar icon and click it:
	await vscode.commands.executeCommand('workbench.view.extension.test');
	
	// Find the "Run All Tests" button and click it:
	// await vscode.commands.executeCommand('testing.runAll');
	
	const extension = vscode.extensions.getExtension('socketry.sus-vscode');
	const projects = extension?.exports;
	const identifiers = Object.keys(projects);
	
	assert(identifiers.length > 0);
	
	identifiers.forEach((key) => {
		const project = projects[key];
		const workspace = project.workspaceFolder;
		
		assert(project);
		assert(project.controller);
		assert(project.controller.items.size > 0);
	});
});
