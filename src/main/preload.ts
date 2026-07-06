import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

const api = {
  listMeetings: (query?: string) => ipcRenderer.invoke('meetings:list', query),
  getMeeting: (id: string) => ipcRenderer.invoke('meetings:get', id),
  createMeeting: () => ipcRenderer.invoke('meetings:create'),
  updateMeeting: (id: string, patch: object) => ipcRenderer.invoke('meetings:update', id, patch),
  deleteMeeting: (id: string) => ipcRenderer.invoke('meetings:delete', id),

  startRecording: (meetingId: string) => ipcRenderer.invoke('recording:start', meetingId),
  stopRecording: () => ipcRenderer.invoke('recording:stop'),

  enhance: (meetingId: string) => ipcRenderer.invoke('ai:enhance', meetingId),
  chat: (meetingId: string, question: string) => ipcRenderer.invoke('ai:chat', meetingId, question),
  checkOllama: () => ipcRenderer.invoke('ai:check'),

  onTranscript: (cb: (meetingId: string, segment: { t: number; text: string }) => void) => {
    const listener = (_e: IpcRendererEvent, meetingId: string, segment: { t: number; text: string }) =>
      cb(meetingId, segment);
    ipcRenderer.on('transcript:segment', listener);
    return () => ipcRenderer.removeListener('transcript:segment', listener);
  },
  onRecordingStatus: (cb: (status: string, message: string) => void) => {
    const listener = (_e: IpcRendererEvent, status: string, message: string) => cb(status, message);
    ipcRenderer.on('recording:status', listener);
    return () => ipcRenderer.removeListener('recording:status', listener);
  },
  onMicActivity: (cb: (active: boolean, appName?: string) => void) => {
    const onActive = (_e: IpcRendererEvent, appName: string) => cb(true, appName);
    const onInactive = () => cb(false);
    ipcRenderer.on('micwatch:active', onActive);
    ipcRenderer.on('micwatch:inactive', onInactive);
    return () => {
      ipcRenderer.removeListener('micwatch:active', onActive);
      ipcRenderer.removeListener('micwatch:inactive', onInactive);
    };
  },

  getSettings: () => ipcRenderer.invoke('settings:get'),
  chooseObsidianDir: () => ipcRenderer.invoke('settings:chooseObsidianDir'),
  disableObsidian: () => ipcRenderer.invoke('settings:disableObsidian'),
  openDataFolder: () => ipcRenderer.invoke('folders:openData'),
};

export type OpenGranolaApi = typeof api;
contextBridge.exposeInMainWorld('og', api);
