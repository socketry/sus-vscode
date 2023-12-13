import * as assert from 'assert';
import * as vscode from 'vscode';
//import * as myExtension from '../extension';

suite('Test Extension', () => {
	test('Tests are listed', () => {
		// Find the "Testing" activity bar icon and click it:
		vscode.commands.executeCommand('workbench.view.extension.test');
		
		// Find the "Run All Tests" button and click it:
		vscode.commands.executeCommand('workbench.testing.action.runAllTests');
	});
});
