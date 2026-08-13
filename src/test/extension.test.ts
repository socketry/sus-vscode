import * as assert from 'assert';
import {EventEmitter} from 'events';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {PassThrough} from 'stream';
import * as vscode from 'vscode';
//import * as myExtension from '../extension';

import {loadEnvironment} from '../environment';
import {Runner, Tests, FileCoverage} from '../runner';
import {Project} from '../sus';
import {loadTree} from '../tree';

test('activates workspace projects', async () => {
	// Find the "Testing" activity bar icon and click it:
	await vscode.commands.executeCommand('workbench.view.extension.test');
	
	const extension = vscode.extensions.getExtension('socketry.sus-vscode');
	const projects = extension?.exports;
	const identifiers = Object.keys(projects);
	
	assert(identifiers.length > 0);
	
	for (const key of identifiers) {
		const project = projects[key];
		
		assert(project);
		assert(project.controller);
		assert(project.workspaceFolder);
	}
});

test('loads local environment over process environment', async () => {
	const workspaceFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'sus-vscode-'));
	const previousInherited = process.env.SUS_VSCODE_INHERITED;
	const previousOverridden = process.env.SUS_VSCODE_OVERRIDDEN;
	
	try {
		process.env.SUS_VSCODE_INHERITED = 'inherited';
		process.env.SUS_VSCODE_OVERRIDDEN = 'global';
		
		await fs.writeFile(
			path.join(workspaceFolder, '.env.sus'),
			'SUS_VSCODE_OVERRIDDEN=local\nSUS_VSCODE_LOCAL=local\n'
		);
		
		const environment = await loadEnvironment(workspaceFolder);
		
		assert.strictEqual(environment.SUS_VSCODE_INHERITED, 'inherited');
		assert.strictEqual(environment.SUS_VSCODE_OVERRIDDEN, 'local');
		assert.strictEqual(environment.SUS_VSCODE_LOCAL, 'local');
	} finally {
		if (previousInherited === undefined) {
			delete process.env.SUS_VSCODE_INHERITED;
		} else {
			process.env.SUS_VSCODE_INHERITED = previousInherited;
		}
		
		if (previousOverridden === undefined) {
			delete process.env.SUS_VSCODE_OVERRIDDEN;
		} else {
			process.env.SUS_VSCODE_OVERRIDDEN = previousOverridden;
		}
		
		await fs.rm(workspaceFolder, {recursive: true, force: true});
	}
});

test('loads test tree from sus json', () => {
	const tree = loadTree({
		self: ['root', 'All tests', false],
		children: [
			{
				self: ['test/example.rb', 'Example', false],
				children: [
					{self: ['test/example.rb:12', 'passes', true]}
				]
			}
		]
	});
	
	const file = tree.get('test/example.rb');
	const leaf = tree.get('test/example.rb:12');
	const visited: string[] = [];
	
	tree.root.traverse(node => visited.push(node.identity));
	
	assert.strictEqual(tree.root.identity, 'root');
	assert.strictEqual(file?.description, 'Example');
	assert.strictEqual(leaf?.leaf, true);
	assert.deepStrictEqual(visited, ['root', 'test/example.rb', 'test/example.rb:12']);
});

test('project updates test items from tree', async () => {
	const controller = vscode.tests.createTestController('project-tree', 'Project Tree');
	const project = new Project(createWorkspaceFolder(), controller);
	
	try {
		await project.updateTree(loadTree({
			self: ['root', 'All tests', false],
			children: [
				{
					self: ['test/example.rb', 'Example', false],
					children: [
						{self: ['test/example.rb:12', 'passes', true]}
					]
				}
			]
		}));
		
		const file = controller.items.get('test/example.rb');
		const leaf = file?.children.get('test/example.rb:12');
		
		assert.strictEqual(controller.items.size, 1);
		assert.strictEqual(file?.label, 'Example');
		assert.strictEqual(file?.uri?.fsPath, '/tmp/sus-vscode-workspace/test/example.rb');
		assert.strictEqual(leaf?.label, 'passes');
		assert.strictEqual(leaf?.range?.start.line, 11);
		
		await project.updateTree(loadTree({self: ['root', 'All tests', false], children: []}));
		
		assert.strictEqual(controller.items.size, 0);
	} finally {
		project.dispose();
	}
});

test('runner maps host results to test run events', () => {
	const controller = vscode.tests.createTestController('runner-results', 'Runner Results');
	
	try {
		const passed = controller.createTestItem('passed', 'passed');
		const remaining = controller.createTestItem('remaining', 'remaining');
		const tests: Tests = {passed, remaining};
		const events: string[] = [];
		const run = createTestRun({
			started: (item: vscode.TestItem) => events.push(`started:${item.id}`),
			passed: (item: vscode.TestItem, duration: number) => events.push(`passed:${item.id}:${duration}`),
			skipped: (item: vscode.TestItem) => events.push(`skipped:${item.id}`)
		});
		const child = createChildProcess();
		const runner = new Runner(run, createWorkspaceFolder(), tests, child as any);
		
		runner.onData({started: 'passed'});
		runner.onData({passed: 'passed', duration: 15});
		runner.skipRemainingTests();
		
		assert.deepStrictEqual(events, [
			'started:passed',
			'passed:passed:15',
			'skipped:remaining'
		]);
		assert.deepStrictEqual(Object.keys(tests), ['remaining']);
	} finally {
		controller.dispose();
	}
});

test('runner maps failure messages and locations', () => {
	const controller = vscode.tests.createTestController('runner-failures', 'Runner Failures');
	
	try {
		const failed = controller.createTestItem('failed', 'failed');
		const tests: Tests = {failed};
		let failedItem: vscode.TestItem | undefined;
		let failedMessages: vscode.TestMessage[] = [];
		let failedDuration: number | undefined;
		const run = createTestRun({
			failed: (item: vscode.TestItem, messages: vscode.TestMessage[], duration: number) => {
				failedItem = item;
				failedMessages = messages;
				failedDuration = duration;
			}
		});
		const runner = new Runner(run, createWorkspaceFolder(), tests, createChildProcess() as any);
		
		runner.onData({
			failed: 'failed',
			duration: 23,
			message: {
				text: 'Expected values to match',
				location: {path: '/tmp/example.rb', line: 7, column: 2}
			}
		});
		
		assert.strictEqual(failedItem?.id, 'failed');
		assert.strictEqual(failedDuration, 23);
		assert.strictEqual(failedMessages.length, 1);
		assert.strictEqual(failedMessages[0].message, 'Expected values to match');
		assert.strictEqual(failedMessages[0].location?.uri.fsPath, '/tmp/example.rb');
		assert.strictEqual(failedMessages[0].location?.range.start.line, 6);
		assert.strictEqual(failedMessages[0].location?.range.start.character, 2);
		assert.deepStrictEqual(Object.keys(tests), []);
	} finally {
		controller.dispose();
	}
});

test('runner records file coverage details', () => {
	const coverage: vscode.FileCoverage[] = [];
	const run = createTestRun({addCoverage: (fileCoverage: vscode.FileCoverage) => coverage.push(fileCoverage)});
	const runner = new Runner(run, createWorkspaceFolder(), {}, createChildProcess() as any);
	
	runner.onData({coverage: '/tmp/example.rb', counts: [null, 3, 0]});
	
	assert.strictEqual(coverage.length, 1);
	assert(coverage[0] instanceof FileCoverage);
	assert.strictEqual(coverage[0].uri.fsPath, '/tmp/example.rb');
	assert.strictEqual((coverage[0] as FileCoverage).details.length, 2);
});

function createWorkspaceFolder(): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file('/tmp/sus-vscode-workspace'),
		name: 'sus-vscode-workspace',
		index: 0
	};
}

function createChildProcess() {
	const child = new EventEmitter() as EventEmitter & {
		stdin: PassThrough;
		stdout: PassThrough;
		stderr: PassThrough;
		kill: () => boolean;
	};
	
	child.stdin = new PassThrough();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.kill = () => true;
	
	return child;
}

function createTestRun(overrides: Record<string, any> = {}) {
	return {
		appendOutput: () => undefined,
		started: () => undefined,
		passed: () => undefined,
		failed: () => undefined,
		errored: () => undefined,
		skipped: () => undefined,
		end: () => undefined,
		addCoverage: () => undefined,
		...overrides
	} as unknown as vscode.TestRun;
}
