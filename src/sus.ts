import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as ndjson from 'ndjson';
import { timingSafeEqual } from 'crypto';

async function execute(command: Array<string>, root: string): Promise<any> {
	const child = child_process.spawn(command[0], command.slice(1), { shell: true, stdio: [process.stdin, 'pipe', process.stderr], cwd: root });

	return new Promise((resolve, reject) => {
		let stdout = '';
		child.stdout.on('data', (data) => stdout += data);
		child.stdout.on('end', () => resolve(stdout));
		child.on('error', reject);
	});
}

export class Tree {
	root: Node;
	identifiers: Map<string, Node>;

	constructor(root: Node) {
		this.root = root;
		this.identifiers = new Map();

		this.expand(this.root);
	}

	get(identifier: string) {
		return this.identifiers.get(identifier);
	}

	expand(node: Node) {
		this.identifiers.set(node.identity, node);

		for (const child of node.children) {
			this.expand(child);
		}
	}
}

export class Node {
	identity: string;
	description: string;
	leaf: boolean;

	children: Node[] = [];

	constructor(identity: string, description: string, leaf: boolean) {
		this.identity = identity;
		this.description = description;
		this.leaf = leaf;
	}

	traverse(callback: (node: Node) => void) {
		callback(this);

		for (const child of this.children) {
			child.traverse(callback);
		}
	}
}

export function loadNodes(json: any) {
	const [identity, description, leaf] = json['self'];
	const children = json['children'];

	const node = new Node(identity, description, leaf);

	if (children) {
		for (const child of children) {
			node.children.push(loadNodes(child));
		}
	}

	return node;
}

export function loadTree(json: any) {
	const node = loadNodes(json);
	return new Tree(node);
}

export async function loadTreeFromPath(path: string) {
	const data = await execute(["bundle", "exec", "sus-tree"], path);
	const json = JSON.parse(data);
	return loadTree(json);
}

interface Tests {[key: string]: vscode.TestItem}

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

	async runAllTests() {
		const testRun = this.controller.createTestRun(new vscode.TestRunRequest(), "Run all tests", true);
		const items = this.controller.items;
		const tests: Tests = {};

		function add(items: readonly vscode.TestItem[] | vscode.TestItemCollection) {
			items.forEach(item => {
				if (item.children.size > 0) add(item.children);
				else tests[item.id] = item;
			});
		}

		add(items);

		const runner = new Runner(testRun, this.workspaceFolder, tests, undefined);
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

		this.controller.refreshHandler = this.loadTree.bind(this, false);
		this.controller.resolveHandler = this.resolveTree.bind(this);
		this.controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, this.runHandler.bind(this), true, undefined);
		// this.controller.createRunProfile('Coverage', vscode.TestRunProfileKind.Coverage, this.runHandler.bind(this), true, undefined);
	}
}

function openHost(root: string) {
	const env = Object.assign({'COVERAGE': 'Quiet'}, process.env);

	return child_process.spawn("bundle", ["exec", "sus-host"], {shell: true, stdio: 'pipe', cwd: root, env});
}

export class Runner implements vscode.Disposable, vscode.TestCoverageProvider {
	testRun: vscode.TestRun;
	workspaceFolder: vscode.WorkspaceFolder;
	tests: Tests;

	child: child_process.ChildProcess;
	output: any;

	coverage: vscode.FileCoverage[] = [];

	finished: Promise<void>;

	constructor(testRun: vscode.TestRun, workspaceFolder: vscode.WorkspaceFolder, tests: Tests, cancellation: vscode.CancellationToken | undefined) {
		this.testRun = testRun;
		this.workspaceFolder = workspaceFolder;
		this.tests = tests;

		this.testRun.coverageProvider = this;

		this.child = openHost(this.workspaceFolder.uri.fsPath);

		cancellation?.onCancellationRequested(() => {
			this.child.kill();
		});

		this.child.on('exit', (code: number) => {
			this.appendOutput(`Test host exited with code ${code}\r\n`);
		});
		this.child.on('error', (error: Error) => {
			this.appendOutput(error.message);
		});
		this.child.stderr?.on('data', (data: Buffer) => {
			this.appendOutput(data.toString());
		});

		this.child.stdout?.pipe(ndjson.parse()).on('data', this.onData.bind(this));
		this.output = ndjson.stringify();
		this.output.on('data', (line: string) => this.child.stdin?.write(line));

		this.finished = new Promise((resolve, reject) => {
			this.child.addListener('error', reject);
			this.child.addListener('exit', resolve);
		});

		// Kick off the test run:
		this.output.write({ run: Object.keys(this.tests) });
	}

	appendOutput(text: string) {
		const lines = text.split(/\r?\n/);
		this.testRun.appendOutput(lines.join("\r\n"));
	}

	dispose() {
		this.child.kill();
	}

	provideFileCoverage() {
		return this.coverage;
	}

	messageBodyFor(data: any) {
		if (data.text) {
			return data.text;
		}
		// else if (data.markdownBody) {
		// 	return new vscode.MarkdownString(data.markdownBody);
		// }
	}

	messageFor(data: any) : vscode.TestMessage {
		// This is a legacy format, we can drop this eventually:
		if (typeof data === 'string') {
			return new vscode.TestMessage(data);
		}

		const body = this.messageBodyFor(data);

		let message = null;

		if (data.actual && data.expected) {
			message = vscode.TestMessage.diff(body, data.actual, data.expected);
		} else {
			message = new vscode.TestMessage(body);
		}

		if (data.location) {
			message.location = new vscode.Location(
				vscode.Uri.file(data.location.path),
				new vscode.Position(data.location.line - 1, data.location.column || 0)
			);
		}

		return message;
	}

	messagesFor(data: any) : vscode.TestMessage | vscode.TestMessage[] {
		if (data.message) {
			return this.messageFor(data);
		}
		else if (data.messages) {
			return data.messages.map(this.messageFor.bind(this));
		} else {
			return [];
		}
	}

	popTest(identity: string) {
		const test = this.tests[identity];
		delete this.tests[identity];
		return test;
	}

	skipRemainingTests() {
		for (const identity in this.tests) {
			this.testRun.skipped(this.tests[identity]);
		}
	}

	addCoverage(data: any) {
		const uri = vscode.Uri.file(data.coverage);
		const statementCoverage: vscode.StatementCoverage[] = [];

		for (let lineNumber = 0; lineNumber < data.counts.length; lineNumber++) {
			const count = data.counts[lineNumber];
			if (count) {
				statementCoverage.push(new vscode.StatementCoverage(count, new vscode.Position(lineNumber, 0)));
			}
		}

		const fileCoverage = vscode.FileCoverage.fromDetails(uri, statementCoverage);
		this.coverage.push(fileCoverage);

		return fileCoverage;
	}

	onData(data: any) {
		if (data.started) {
			this.testRun.started(this.tests[data.started]);
		}
		else if (data.passed) {
			this.testRun.passed(this.popTest(data.passed), data.duration);
		}
		else if (data.failed) {
			this.testRun.failed(this.popTest(data.failed), this.messagesFor(data), data.duration);
		}
		else if (data.errored) {
			this.testRun.errored(this.popTest(data.errored), this.messagesFor(data), data.duration);
		}
		else if (data.finished) {
			this.appendOutput(data.message);
			this.child.stdin?.end();
		}
		else if (data.coverage) {
			this.addCoverage(data);
		}
	}

	async run() {
		this.appendOutput(`Running tests in ${this.workspaceFolder.name}...\r\n`);
		try {
			await this.finished;
		} catch (error: any) {
			console.log("await this.finished", error);
		} finally {
			this.skipRemainingTests();
			this.testRun.end();
		}
	}
}
