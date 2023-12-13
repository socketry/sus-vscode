// Released under the MIT License.
// Copyright, 2023, by Samuel Williams.

import * as vscode from 'vscode';
import {Project} from './sus';

export type Projects = {[key: string]: Project};

export async function activate(context: vscode.ExtensionContext): Promise<Projects> {
	const projects = {} as {[key: string]: Project};
	
	async function addProject(workspaceFolder: vscode.WorkspaceFolder) {
		const identifier = workspaceFolder.uri.toString();
		const project = projects[identifier];
		if (!project) {
			const controller = vscode.tests.createTestController(identifier, workspaceFolder.name);
			const project = new Project(workspaceFolder, controller);
			context.subscriptions.push(project);
			projects[identifier] = project;
			
			await project.setup();
		}
	}
	
	function removeProject(workspaceFolder: vscode.WorkspaceFolder) {
		const identifier = workspaceFolder.uri.toString();
		const project = projects[identifier];
		if (project) {
			project.dispose();
			delete projects[identifier];
		}
	}
	
	function updateProjects(event: vscode.WorkspaceFoldersChangeEvent) {
		if (!vscode.workspace.workspaceFolders) {
			return [];
		}
		
		event.removed.forEach(removeProject);
		event.added.forEach(addProject);
		
		return null;
	}
	
	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(updateProjects));
	
	if (vscode.workspace.workspaceFolders) {
		vscode.workspace.workspaceFolders.forEach(addProject);
	}
	
	return projects;
}
