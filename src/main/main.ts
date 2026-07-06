import { app, BrowserWindow, ipcMain, dialog, shell, Notification } from 'electron';
import { spawn, ChildProcess, execFile } from 'child_process';
import * as path from 'path';
import * as store from './store';
import { Recorder } from './recorder';
import { enhance, chatAboutTranscript, checkOllama } from './ollama';
import { getSettings, updateSettings } from './settings';
import { Meeting } from './types';

let win: BrowserWindow | null = null;
let micWatcher: ChildProcess | null = null;

const recorder = new Recorder({
  onSegment: (segment) => {
    const id = recorder.meetingId;
    if (!id) return;
    const meeting = store.getMeeting(id);
    if (meeting) {
      meeting.transcript.push(segment);
      store.saveMeeting(meeting); // persist each segment so live chat & crash recovery see it
    }
    win?.webContents.send('transcript:segment', id, segment);
  },
  onStatus: (status, message) => {
    win?.webContents.send('recording:status', status, message);
  },
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'OpenGranola',
    backgroundColor: '#111213',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// ---- Mic-in-use watcher: prompts to start recording when another app starts capturing ----
function appNameForPid(pid: number): Promise<string> {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-p', String(pid), '-o', 'comm='], (err, stdout) => {
      if (err || !stdout.trim()) return resolve('An app');
      const bin = stdout.trim();
      // for bundled apps, use the .app name rather than the binary path
      const appMatch = bin.match(/([^/]+)\.app\//);
      resolve(appMatch ? appMatch[1] : path.basename(bin));
    });
  });
}

function startMicWatcher() {
  const bin = path.join(__dirname, '..', 'native', 'audiocap');
  micWatcher = spawn(bin, ['micwatch'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let buf = '';
  micWatcher.stdout!.on('data', async (data: Buffer) => {
    buf += data.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith('MIC:on') && !recorder.isRecording) {
        const pid = parseInt(line.split(' ')[1] ?? '', 10);
        const appName = Number.isFinite(pid) ? await appNameForPid(pid) : 'An app';
        if (appName === 'OpenGranola' || appName === 'Electron') continue; // our own capture
        win?.webContents.send('micwatch:active', appName);
        const n = new Notification({
          title: 'Meeting starting?',
          body: `${appName} just started using your microphone. Click to start recording.`,
          silent: true,
        });
        n.on('click', () => {
          win?.show();
          win?.focus();
        });
        n.show();
      } else if (line.startsWith('MIC:off')) {
        win?.webContents.send('micwatch:inactive');
      }
    }
  });
  micWatcher.on('exit', () => {
    micWatcher = null; // watcher is best-effort; don't respawn-loop on failure
  });
}

app.whenReady().then(() => {
  createWindow();
  startMicWatcher();
});
app.on('window-all-closed', async () => {
  micWatcher?.kill('SIGTERM');
  await recorder.stop();
  app.quit();
});

// ---- Meetings ----
ipcMain.handle('meetings:list', (_e, query?: string) => store.listMeetings(query));
ipcMain.handle('meetings:get', (_e, id: string) => store.getMeeting(id));
ipcMain.handle('meetings:create', () => store.createMeeting());
ipcMain.handle('meetings:update', (_e, id: string, patch: Partial<Meeting>) => store.updateMeeting(id, patch));
ipcMain.handle('meetings:delete', async (_e, id: string) => {
  const meeting = store.getMeeting(id);
  if (!meeting || !win) return false;
  const res = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Move to Trash', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `Delete "${meeting.title}"?`,
    detail: 'The meeting file (and its Obsidian export, if any) will be moved to the Trash, so you can still recover it from there.',
  });
  if (res.response !== 0) return false;
  await store.trashMeeting(id);
  return true;
});

// ---- Settings / folders ----
ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:chooseObsidianDir', async () => {
  if (!win) return getSettings();
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose the folder in your Obsidian vault for meeting notes',
    defaultPath: getSettings().obsidianDir ?? path.join(app.getPath('home'), 'vault'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (!res.canceled && res.filePaths[0]) updateSettings({ obsidianDir: res.filePaths[0] });
  return getSettings();
});
ipcMain.handle('settings:disableObsidian', () => updateSettings({ obsidianDir: undefined }));
ipcMain.handle('folders:openData', () => shell.openPath(store.meetingsDir()));

// ---- Recording ----
ipcMain.handle('recording:start', (_e, meetingId: string) => recorder.start(meetingId));
ipcMain.handle('recording:stop', async () => {
  await recorder.stop();
  return { ok: true };
});

// ---- AI ----
ipcMain.handle('ai:check', () => checkOllama());

ipcMain.handle('ai:enhance', async (_e, meetingId: string) => {
  const meeting = store.getMeeting(meetingId);
  if (!meeting) return { ok: false, error: 'Meeting not found' };
  const health = await checkOllama();
  if (!health.ok) return { ok: false, error: health.error };
  try {
    const enhanced = await enhance(meeting);
    store.updateMeeting(meetingId, { enhanced });
    return { ok: true, enhanced };
  } catch (err: any) {
    return { ok: false, error: `Enhance failed: ${err.message}` };
  }
});

ipcMain.handle('ai:chat', async (_e, meetingId: string, question: string) => {
  const meeting = store.getMeeting(meetingId); // re-read: during recording this includes segments so far
  if (!meeting) return { ok: false, error: 'Meeting not found' };
  const health = await checkOllama();
  if (!health.ok) return { ok: false, error: health.error };
  try {
    const answer = await chatAboutTranscript(meeting, question);
    const now = Date.now();
    // re-read again before saving: transcript may have grown while the model was answering
    const fresh = store.getMeeting(meetingId);
    if (fresh) {
      fresh.chat.push({ role: 'user', text: question, at: now });
      fresh.chat.push({ role: 'assistant', text: answer, at: Date.now() });
      store.saveMeeting(fresh);
    }
    return { ok: true, answer };
  } catch (err: any) {
    return { ok: false, error: `Chat failed: ${err.message}` };
  }
});
