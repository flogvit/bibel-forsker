import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export interface RektorState {
  running: boolean;
  startedAt: string | null;
  tasksCompleted: number;
  lastReflection: string | null;
  currentFocus: string | null;
}

const STATE_FILE = '.rektor-state.json';

export async function loadState(): Promise<RektorState> {
  if (!existsSync(STATE_FILE)) {
    return {
      running: false,
      startedAt: null,
      tasksCompleted: 0,
      lastReflection: null,
      currentFocus: null,
    };
  }
  return JSON.parse(await readFile(STATE_FILE, 'utf-8'));
}

export async function saveState(state: RektorState): Promise<void> {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

export async function readResearchRules(path: string): Promise<string> {
  if (!existsSync(path)) return '';
  return readFile(path, 'utf-8');
}

export async function writeResearchRules(path: string, content: string): Promise<void> {
  await writeFile(path, content);
}
