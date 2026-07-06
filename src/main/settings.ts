import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface Settings {
  obsidianDir?: string; // folder inside the user's vault to export meeting markdown into
}

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function getSettings(): Settings {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Settings;
  } catch {
    return {};
  }
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}
