import React, { useCallback, useEffect, useRef, useState } from 'react';
import { renderMarkdown } from './markdown';

interface Segment { t: number; text: string; who?: 'me' | 'them' }
interface ChatMsg { role: 'user' | 'assistant'; text: string; at: number }
interface Meeting {
  id: string; title: string; createdAt: number; template: string;
  transcript: Segment[]; notes: string; enhanced: string; chat: ChatMsg[];
}
interface Summary { id: string; title: string; createdAt: number; hasEnhanced: boolean }

declare global {
  interface Window {
    og: {
      listMeetings(query?: string): Promise<Summary[]>;
      getMeeting(id: string): Promise<Meeting | null>;
      createMeeting(): Promise<Meeting>;
      updateMeeting(id: string, patch: Partial<Meeting>): Promise<Meeting | null>;
      deleteMeeting(id: string): Promise<boolean>;
      startRecording(meetingId: string): Promise<{ ok: boolean; error?: string }>;
      stopRecording(): Promise<{ ok: boolean }>;
      enhance(meetingId: string): Promise<{ ok: boolean; enhanced?: string; error?: string }>;
      chat(meetingId: string, q: string): Promise<{ ok: boolean; answer?: string; error?: string }>;
      checkOllama(): Promise<{ ok: boolean; error?: string }>;
      onTranscript(cb: (meetingId: string, seg: Segment) => void): () => void;
      onRecordingStatus(cb: (status: string, message: string) => void): () => void;
      onMicActivity(cb: (active: boolean, appName?: string) => void): () => void;
      getSettings(): Promise<{ obsidianDir?: string }>;
      chooseObsidianDir(): Promise<{ obsidianDir?: string }>;
      disableObsidian(): Promise<{ obsidianDir?: string }>;
      openDataFolder(): Promise<void>;
    };
  }
}

const TEMPLATES = [
  { id: 'generic', label: 'Generic meeting' },
  { id: '1on1', label: '1:1' },
  { id: 'standup', label: 'Standup' },
  { id: 'sales', label: 'Sales call' },
  { id: 'discovery', label: 'Customer discovery' },
];

function ts(t: number): string {
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export default function App() {
  const [meetings, setMeetings] = useState<Summary[]>([]);
  const [search, setSearch] = useState('');
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState<'ok' | 'warn' | 'err'>('ok');
  const [enhancing, setEnhancing] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [ollamaErr, setOllamaErr] = useState<string | null>(null);
  const [micPrompt, setMicPrompt] = useState<string | null>(null); // app name using the mic
  const [obsidianDir, setObsidianDir] = useState<string | undefined>(undefined);

  const meetingRef = useRef<Meeting | null>(null);
  meetingRef.current = meeting;
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshList = useCallback(async (q?: string) => {
    setMeetings(await window.og.listMeetings(q));
  }, []);

  useEffect(() => {
    void refreshList();
    void window.og.checkOllama().then((r) => setOllamaErr(r.ok ? null : r.error ?? 'Ollama unavailable'));
    const offT = window.og.onTranscript((mid, seg) => {
      const cur = meetingRef.current;
      if (cur && cur.id === mid) {
        setMeeting({ ...cur, transcript: [...cur.transcript, seg] });
      }
    });
    const offS = window.og.onRecordingStatus((st, msg) => {
      setStatus(msg);
      if (st === 'recording') { setRecording(true); setStatusKind('ok'); setMicPrompt(null); }
      if (st === 'stopped') { setRecording(false); setStatusKind('ok'); }
      if (st === 'warning') setStatusKind('warn');
      if (st === 'error') { setRecording(false); setStatusKind('err'); }
    });
    const offM = window.og.onMicActivity((active, appName) => {
      setMicPrompt(active ? appName ?? 'An app' : null);
    });
    void window.og.getSettings().then((s) => setObsidianDir(s.obsidianDir));
    return () => { offT(); offS(); offM(); };
  }, [refreshList]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [meeting?.transcript.length]);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [meeting?.chat.length, chatBusy]);

  const openMeeting = async (id: string) => {
    if (recording) return; // don't switch away while recording
    const m = await window.og.getMeeting(id);
    if (m) setMeeting(m);
  };

  const newMeeting = async () => {
    if (recording) return;
    const m = await window.og.createMeeting();
    setMeeting(m);
    void refreshList(search || undefined);
  };

  const startRecording = async () => {
    let m = meeting;
    if (!m) {
      m = await window.og.createMeeting();
      setMeeting(m);
      void refreshList(search || undefined);
    }
    setStatus('Starting audio capture…');
    setStatusKind('ok');
    const res = await window.og.startRecording(m.id);
    if (!res.ok) { setStatus(res.error ?? 'Failed to start'); setStatusKind('err'); }
  };

  const stopRecording = async () => {
    setStatus('Stopping…');
    await window.og.stopRecording();
    setRecording(false);
    // reload meeting to pick up final flushed segments
    if (meetingRef.current) {
      const m = await window.og.getMeeting(meetingRef.current.id);
      if (m) setMeeting(m);
    }
  };

  const doEnhance = async () => {
    if (!meeting || enhancing) return;
    setEnhancing(true);
    setStatus('Enhancing notes with local LLM…');
    setStatusKind('ok');
    const res = await window.og.enhance(meeting.id);
    setEnhancing(false);
    if (res.ok && res.enhanced != null) {
      setMeeting({ ...meetingRef.current!, enhanced: res.enhanced });
      setStatus('Notes enhanced');
      void refreshList(search || undefined);
    } else {
      setStatus(res.error ?? 'Enhance failed');
      setStatusKind('err');
    }
  };

  const sendChat = async () => {
    const q = chatInput.trim();
    if (!q || !meeting || chatBusy) return;
    setChatInput('');
    setChatBusy(true);
    const optimistic: ChatMsg = { role: 'user', text: q, at: Date.now() };
    setMeeting({ ...meetingRef.current!, chat: [...meetingRef.current!.chat, optimistic] });
    const res = await window.og.chat(meeting.id, q);
    const answer: ChatMsg = {
      role: 'assistant',
      text: res.ok ? res.answer ?? '' : `⚠️ ${res.error}`,
      at: Date.now(),
    };
    setMeeting({ ...meetingRef.current!, chat: [...meetingRef.current!.chat, answer] });
    setChatBusy(false);
  };

  const onNotesChange = (val: string) => {
    if (!meeting) return;
    setMeeting({ ...meeting, notes: val });
    if (notesTimer.current) clearTimeout(notesTimer.current);
    const id = meeting.id;
    notesTimer.current = setTimeout(() => void window.og.updateMeeting(id, { notes: val }), 400);
  };

  const onTitleChange = (val: string) => {
    if (!meeting) return;
    setMeeting({ ...meeting, title: val });
    if (notesTimer.current) clearTimeout(notesTimer.current);
    const id = meeting.id;
    notesTimer.current = setTimeout(() => {
      void window.og.updateMeeting(id, { title: val }).then(() => refreshList(search || undefined));
    }, 400);
  };

  const onTemplateChange = (val: string) => {
    if (!meeting) return;
    setMeeting({ ...meeting, template: val });
    void window.og.updateMeeting(meeting.id, { template: val });
  };

  const onDelete = async (id: string) => {
    const deleted = await window.og.deleteMeeting(id); // main shows a confirm dialog; moves to Trash
    if (!deleted) return;
    if (meeting?.id === id) setMeeting(null);
    void refreshList(search || undefined);
  };

  // "meeting detected" prompt: start recording in a fresh meeting
  const startFromMicPrompt = async () => {
    setMicPrompt(null);
    const m = await window.og.createMeeting();
    setMeeting(m);
    void refreshList(search || undefined);
    const res = await window.og.startRecording(m.id);
    if (!res.ok) { setStatus(res.error ?? 'Failed to start'); setStatusKind('err'); }
  };

  const toggleObsidian = async () => {
    const s = obsidianDir ? await window.og.disableObsidian() : await window.og.chooseObsidianDir();
    setObsidianDir(s.obsidianDir);
  };

  return (
    <div className="app">
      {micPrompt && !recording && (
        <div className="mic-banner">
          <span>🎤 <strong>{micPrompt}</strong> just started using your microphone — meeting starting?</span>
          <button className="btn record" onClick={startFromMicPrompt}>● Start recording</button>
          <button className="btn" onClick={() => setMicPrompt(null)}>Dismiss</button>
        </div>
      )}
      <aside className="sidebar">
        <div className="brand">🥣 OpenGranola</div>
        <button className="btn primary block" onClick={newMeeting} disabled={recording}>+ New meeting</button>
        <input
          className="search"
          placeholder="Search meetings…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); void refreshList(e.target.value || undefined); }}
        />
        <div className="meeting-list">
          {meetings.map((m) => (
            <div
              key={m.id}
              className={`meeting-item ${meeting?.id === m.id ? 'active' : ''}`}
              onClick={() => void openMeeting(m.id)}
            >
              <div className="meeting-title">{m.title || 'Untitled'}</div>
              <div className="meeting-meta">
                {new Date(m.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {m.hasEnhanced && <span className="badge">✨</span>}
              </div>
              <button className="del" title="Delete" onClick={(e) => { e.stopPropagation(); void onDelete(m.id); }}>×</button>
            </div>
          ))}
          {meetings.length === 0 && <div className="empty">No meetings yet</div>}
        </div>
        {ollamaErr && <div className="ollama-warn" title={ollamaErr}>⚠️ {ollamaErr}</div>}
        <div className="sidebar-footer">
          <button className="footer-link" onClick={() => void window.og.openDataFolder()} title="Open the folder with the meeting JSON files">
            📁 Data folder
          </button>
          <button
            className="footer-link"
            onClick={toggleObsidian}
            title={obsidianDir ? `Exporting markdown to ${obsidianDir} — click to disable` : 'Export every meeting as Markdown into your Obsidian vault'}
          >
            {obsidianDir ? '🔮 Obsidian ✓' : '🔮 Obsidian sync…'}
          </button>
        </div>
      </aside>

      {meeting ? (
        <main className="main">
          <header className="topbar">
            <input className="title-input" value={meeting.title} onChange={(e) => onTitleChange(e.target.value)} />
            <select value={meeting.template} onChange={(e) => onTemplateChange(e.target.value)} disabled={enhancing}>
              {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            {!recording ? (
              <button className="btn record" onClick={startRecording}>● Start</button>
            ) : (
              <button className="btn recording" onClick={stopRecording}>■ Stop</button>
            )}
            <button className="btn primary" onClick={doEnhance} disabled={enhancing || recording || meeting.transcript.length === 0}>
              {enhancing ? 'Enhancing…' : '✨ Enhance'}
            </button>
          </header>
          {status && <div className={`statusbar ${statusKind}`}>{recording && <span className="pulse" />} {status}</div>}

          <div className="panels">
            <section className="panel transcript-panel">
              <div className="panel-head">Transcript {recording && <span className="live-tag">LIVE</span>}</div>
              <div className="transcript">
                {meeting.transcript.map((s, i) => (
                  <div className="seg" key={i}>
                    <span className="seg-t">{ts(s.t)}</span>
                    {s.who && <span className={`seg-who ${s.who}`}>{s.who === 'me' ? 'Me' : 'Them'}</span>}
                    <span className="seg-text">{s.text}</span>
                  </div>
                ))}
                {meeting.transcript.length === 0 && (
                  <div className="empty">No transcript yet. Hit ● Start to begin capturing mic + system audio.</div>
                )}
                <div ref={transcriptEndRef} />
              </div>
              <div className="chatbox">
                <div className="chat-msgs">
                  {meeting.chat.map((c, i) => (
                    <div key={i} className={`chat-msg ${c.role}`}>{c.text}</div>
                  ))}
                  {chatBusy && <div className="chat-msg assistant thinking">Thinking…</div>}
                  <div ref={chatEndRef} />
                </div>
                <div className="chat-input-row">
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void sendChat()}
                    placeholder={recording ? 'Ask about the meeting so far…' : 'Ask about this meeting…'}
                    disabled={chatBusy}
                  />
                  <button className="btn" onClick={sendChat} disabled={chatBusy || !chatInput.trim()}>Ask</button>
                </div>
              </div>
            </section>

            <section className="panel notes-panel">
              <div className="panel-head">My notes <span className="hint">(fragments are fine — Enhance expands them)</span></div>
              <textarea
                className="notes-editor"
                value={meeting.notes}
                onChange={(e) => onNotesChange(e.target.value)}
                placeholder={'pricing concern\nfollow up re: contract\n…'}
              />
              <div className="panel-head enhanced-head">Enhanced notes <span className="hint">(AI-generated from your notes + transcript)</span></div>
              <div className="enhanced">
                {meeting.enhanced ? (
                  <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(meeting.enhanced) }} />
                ) : (
                  <div className="empty">{enhancing ? 'Generating…' : 'Click ✨ Enhance after the meeting to generate structured notes.'}</div>
                )}
              </div>
            </section>
          </div>
        </main>
      ) : (
        <main className="main welcome">
          <div>
            <h1>🥣 OpenGranola</h1>
            <p>Local, private AI meeting notes. Mic + system audio → whisper.cpp → your notes + Ollama.</p>
            <button className="btn primary" onClick={newMeeting}>+ New meeting</button>
            <button className="btn record" onClick={startRecording} style={{ marginLeft: 8 }}>● Start recording now</button>
          </div>
        </main>
      )}
    </div>
  );
}
