import * as fs from 'fs/promises';
import * as path from 'path';
import * as dotenv from 'dotenv';

async function loadLocalEnvironment(filePath: string): Promise<Record<string, string>> {
	try {
		const envFile = await fs.readFile(filePath, 'utf-8');
		return dotenv.parse(envFile);
	} catch (error) {
		console.error(`Error loading .env file: ${(error as Error).message}`);
		return {};
	}
}

const ENV_FILE = '.env.sus';

export async function loadEnvironment(workspaceFolder: string): Promise<Record<string, string>> {
	const local = await loadLocalEnvironment(path.join(workspaceFolder, ENV_FILE));
	const global = process.env as Record<string, string>;
	
	return {...global, ...local};
}
