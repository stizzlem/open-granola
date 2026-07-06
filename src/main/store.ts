import { app, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { Meeting, MeetingSummary } from './types';
import { exportToObsidian } from './exporter';

export function meetingsDir(): string {
  const dir = path.join(app.getPath('userData'), 'meetings');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fileFor(id: string): string {
  return path.join(meetingsDir(), `${id}.json`);
}

export function createMeeting(): Meeting {
  const now = new Date();
  const meeting: Meeting = {
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    title: `Meeting ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    createdAt: now.getTime(),
    template: 'generic',
    transcript: [],
    notes: '',
    enhanced: '',
    chat: [],
  };
  saveMeeting(meeting);
  return meeting;
}

export function saveMeeting(meeting: Meeting): void {
  const exported = exportToObsidian(meeting);
  if (exported) meeting.exportFile = exported;
  const file = fileFor(meeting.id);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(meeting, null, 2));
  fs.renameSync(tmp, file);
}

export function getMeeting(id: string): Meeting | null {
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')) as Meeting;
  } catch {
    return null;
  }
}

export function updateMeeting(id: string, patch: Partial<Meeting>): Meeting | null {
  const meeting = getMeeting(id);
  if (!meeting) return null;
  const updated = { ...meeting, ...patch, id: meeting.id, createdAt: meeting.createdAt };
  saveMeeting(updated);
  return updated;
}

/** Move the meeting file (and its Obsidian export, if any) to the macOS Trash. */
export async function trashMeeting(id: string): Promise<void> {
  const meeting = getMeeting(id);
  try {
    await shell.trashItem(fileFor(id));
  } catch {}
  if (meeting?.exportFile) {
    try {
      await shell.trashItem(meeting.exportFile);
    } catch {}
  }
}

export function listMeetings(query?: string): MeetingSummary[] {
  const dir = meetingsDir();
  const metas: MeetingSummary[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Meeting;
      if (query) {
        const q = query.toLowerCase();
        const haystack = [
          m.title,
          m.notes,
          m.enhanced,
          m.transcript.map((s) => s.text).join(' '),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      metas.push({ id: m.id, title: m.title, createdAt: m.createdAt, hasEnhanced: !!m.enhanced });
    } catch {}
  }
  metas.sort((a, b) => b.createdAt - a.createdAt);
  return metas;
}
