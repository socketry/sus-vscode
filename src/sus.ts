import * as vscode from 'vscode';
import * as child_process from 'child_process';

async function execute(command: Array<string>, root: string): Promise<any> {
	const process = child_process.spawn(command[0], command.slice(1), {shell: false, stdio: 'pipe', cwd: root})
	
	return new Promise((resolve, reject) => {
		let stdout = '';
		process.stdout.on('data', (data) => {
			stdout += data;
		});
		process.stdout.on('end', () => {
			resolve(stdout);
		});
		process.on('error', (error) => {
			reject(error);
		});
	});
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
}

export function loadTree(json: any) {
	const [identity, description, leaf] = json['self'];
	const children = json['children']
	
	const node = new Node(identity, description, leaf);
	
	if (children) {
		for (const child of children) {
			node.children.push(loadTree(child));
		}
	}
	
	return node;
}

export function loadTreeFromRoot(root: string) {
	const data = await execute(["bundle", "exec", "sus-tree"], root);
	const json = JSON.parse(data);
	return loadTree(json);
}
// async run(item: vscode.TestItem, testRun: vscode.TestRun): Promise<void> {
// 	const result = await(this.execute(item.uri.fsPath));
// 	const failures = result['failures'];
	
// 	if (failures.length == 0) {
// 		testRun.passed(item, result['duration']);
// 	} else {
// 		for (const failure of failures) {
// 			const diff = failure['diff'];
			
// 			if (failure['expected']) {
// 				const message = vscode.TestMessage.diff(failure['message'], failure['expected'], failure['actual']);
// 				message.location = new vscode.Location(item.uri!, item.range!);
// 				testRun.failed(item, message, result['duration']);
// 			} else {
// 				const message = failure['message'];
// 				testRun.failed(item, message, result['duration']);
// 			}
// 		}
// 	}
// }

