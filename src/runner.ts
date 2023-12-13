// Released under the MIT License.
// Copyright, 2023, by Samuel Williams.

import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as ndjson from 'ndjson';

export interface Tests {[key: string]: vscode.TestItem}

function openHost(root: string) {
	const env = Object.assign({'COVERAGE': 'Quiet'}, process.env);
	
	return child_process.spawn("bundle", ["exec", "sus-host"], {shell: true, stdio: 'pipe', cwd: root, env});
}

export class Runner implements vscode.Disposable {
	testRun: vscode.TestRun;
	workspaceFolder: vscode.WorkspaceFolder;
	tests: Tests;
	
	child: child_process.ChildProcess;
	output: any;
	
	finished: Promise<void>;
	
	constructor(testRun: vscode.TestRun, workspaceFolder: vscode.WorkspaceFolder, tests: Tests, cancellation: vscode.CancellationToken | undefined) {
		this.testRun = testRun;
		this.workspaceFolder = workspaceFolder;
		this.tests = tests;
		
		// this.testRun.coverageProvider = this;
		
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
	
	messageBodyFor(data: any) {
		if (data.text) {
			return data.text;
		}
		// else if (data.markdownBody) {
		// 	return new vscode.MarkdownString(data.markdownBody);
		// }
	}
	
	locationFor(data: any) : vscode.Location | undefined {
		if (data.location) {
			return new vscode.Location(
				vscode.Uri.file(data.location.path),
				new vscode.Position(data.location.line - 1, data.location.column || 0)
			);
		}
	}
	
	messageFor(data: any) : vscode.TestMessage {
		const body = this.messageBodyFor(data);
		
		let message = null;
		
		if (data.actual && data.expected) {
			message = vscode.TestMessage.diff(body, data.actual, data.expected);
		} else {
			message = new vscode.TestMessage(body);
		}
		
		message.location = this.locationFor(data);
		
		return message;
	}
	
	messagesFor(data: any) : vscode.TestMessage[] {
		if (data.message) {
			return [this.messageFor(data.message)];
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
	
	inform(data: any) {
		const test = this.tests[data.inform];
		
		this.messagesFor(data).forEach(message => {
			this.testRun.appendOutput(message.message.toString(), message.location, test);
		});
	}
	
	onData(data: any) {
		if (data.started) {
			this.testRun.started(this.tests[data.started]);
		}
		else if (data.inform) {
			this.inform(data);
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
