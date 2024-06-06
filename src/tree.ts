// Released under the MIT License.
// Copyright, 2023, by Samuel Williams.

import * as child_process from 'child_process';

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

async function execute(command: Array<string>, root: string): Promise<any> {
	const child = child_process.spawn(command[0], command.slice(1), { shell: true, stdio: [process.stdin, 'pipe', process.stderr], cwd: root });
	
	return new Promise((resolve, reject) => {
		let stdout = '';
		child.stdout.on('data', (data) => stdout += data);
		child.stdout.on('end', () => resolve(stdout));
		child.on('error', reject);
	});
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
	try {
		const json = JSON.parse(data);
		return loadTree(json);
	} catch (error) {
		console.error(`Error loading tree: ${(error as Error).message}`, {data: data});
		
		return new Tree(new Node('error', data, true));
	}
}
