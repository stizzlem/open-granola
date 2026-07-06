import { spawn, ChildProcess, execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TranscriptSegment } from './types';

const SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 8; // transcribe every ~8s of audio
const MIN_FLUSH_SECONDS = 0.6; // ignore trailing audio shorter than this on stop
const RMS_SILENCE_THRESHOLD = 90; // int16 RMS below this = silence, skip whisper

const APP_ROOT = path.join(__dirname, '..');
const AUDIOCAP = path.join(APP_ROOT, 'native', 'audiocap');
const MODEL = path.join(APP_ROOT, 'models', 'ggml-base.en.bin');
const WHISPER_CANDIDATES = ['/opt/homebrew/bin/whisper-cli', 'whisper-cli'];

export type RecorderEvents = {
  onSegment: (segment: TranscriptSegment) => void;
  onStatus: (status: 'recording' | 'stopped' | 'error' | 'warning', message: string) => void;
};

// Junk whisper emits on silence/noise
const HALLUCINATION_PATTERNS = [/\[BLANK_AUDIO\]/gi, /\[SILENCE\]/gi, /\(silence\)/gi, /\[MUSIC\]/gi, /\(.*inaudible.*\)/gi];

function whisperBin(): string {
  for (const c of WHISPER_CANDIDATES) {
    if (c.startsWith('/') && fs.existsSync(c)) return c;
  }
  return 'whisper-cli';
}

function wavHeader(numSamples: number): Buffer {
  const dataSize = numSamples * 2;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataSize, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataSize, 40);
  return h;
}

function rmsInt16(buf: Buffer): number {
  const n = Math.floor(buf.length / 2);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = buf.readInt16LE(i * 2);
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

export class Recorder {
  private proc: ChildProcess | null = null;
  private pending: Buffer[] = []; // interleaved stereo s16le: L=me (mic), R=them (system)
  private pendingBytes = 0;
  private samplesConsumed = 0; // total per-channel samples handed to whisper so far
  private busy = false;
  private stopping = false;
  private lastText: { me: string; them: string } = { me: '', them: '' };
  private events: RecorderEvents;
  private mode: 'mix' | 'mic' = 'mix';
  private stopResolve: (() => void) | null = null;
  public meetingId: string | null = null;

  constructor(events: RecorderEvents) {
    this.events = events;
  }

  get isRecording(): boolean {
    return this.proc !== null;
  }

  start(meetingId: string): { ok: boolean; error?: string } {
    if (this.proc) return { ok: false, error: 'Already recording' };
    if (!fs.existsSync(AUDIOCAP)) return { ok: false, error: `audiocap helper not found at ${AUDIOCAP}` };
    if (!fs.existsSync(MODEL)) return { ok: false, error: `whisper model not found at ${MODEL}` };
    this.meetingId = meetingId;
    this.pending = [];
    this.pendingBytes = 0;
    this.samplesConsumed = 0;
    this.lastText = { me: '', them: '' };
    this.stopping = false;
    this.spawnHelper(this.mode);
    return { ok: true };
  }

  private spawnHelper(mode: 'mix' | 'mic') {
    const proc = spawn(AUDIOCAP, [mode], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;

    proc.stdout!.on('data', (data: Buffer) => {
      this.pending.push(data);
      this.pendingBytes += data.length;
      if (this.pendingBytes >= CHUNK_SECONDS * SAMPLE_RATE * 4) {
        // 4 bytes per frame: stereo s16le
        void this.flushChunk(false);
      }
    });

    proc.stderr!.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        if (line.startsWith('ERROR:')) {
          // If system audio fails (no Screen Recording permission), fall back to mic-only
          if (mode === 'mix' && /shareable content|startCapture|system audio/i.test(line)) {
            this.events.onStatus(
              'warning',
              'System audio unavailable (grant Screen Recording permission to Electron in System Settings). Falling back to microphone only.'
            );
            // helper exits itself on these errors; respawn in mic mode
            this.mode = 'mic';
          } else {
            this.events.onStatus('error', line.replace('ERROR: ', ''));
          }
        } else if (line.startsWith('STATUS: streaming')) {
          this.events.onStatus('recording', mode === 'mix' ? 'Recording (mic + system audio)' : 'Recording (mic only)');
        }
      }
    });

    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      if (this.stopping) return; // normal stop path handles the rest
      if (code === 3 && mode === 'mix') {
        // system-audio failure -> retry mic-only
        this.spawnHelper('mic');
      } else if (code === 2) {
        this.events.onStatus('error', 'Microphone permission denied. Grant it in System Settings > Privacy & Security > Microphone.');
      } else {
        this.events.onStatus('error', `Audio capture exited unexpectedly (code ${code})`);
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    this.stopping = true;
    const proc = this.proc;
    const exited = new Promise<void>((resolve) => {
      proc.once('exit', () => resolve());
    });
    proc.kill('SIGTERM');
    await exited;
    this.proc = null;
    // wait for any in-flight whisper run before the final flush, then flush the tail
    while (this.busy) await new Promise((r) => setTimeout(r, 100));
    await this.flushChunk(true);
    while (this.busy) await new Promise((r) => setTimeout(r, 100));
    this.events.onStatus('stopped', 'Recording stopped');
    this.meetingId = null;
  }

  /** Take pending stereo audio, split into me/them channels, run whisper on each. */
  private async flushChunk(final: boolean): Promise<void> {
    if (this.busy) return; // next stdout data event will retry; on stop() we flush after busy clears
    const bytes = this.pendingBytes;
    if (bytes < (final ? MIN_FLUSH_SECONDS : CHUNK_SECONDS) * SAMPLE_RATE * 4) {
      if (!final) return;
      // final flush below threshold: drop it
      this.pending = [];
      this.pendingBytes = 0;
      return;
    }
    const audio = Buffer.concat(this.pending, bytes);
    this.pending = [];
    this.pendingBytes = 0;
    const frames = Math.floor(audio.length / 4);
    const startSample = this.samplesConsumed;
    this.samplesConsumed += frames;
    const t = Math.round(startSample / SAMPLE_RATE);

    // deinterleave L (me) / R (them)
    const me = Buffer.alloc(frames * 2);
    const them = Buffer.alloc(frames * 2);
    for (let i = 0; i < frames; i++) {
      me.writeInt16LE(audio.readInt16LE(i * 4), i * 2);
      them.writeInt16LE(audio.readInt16LE(i * 4 + 2), i * 2);
    }

    this.busy = true;
    try {
      for (const [who, channel] of [['them', them], ['me', me]] as const) {
        if (rmsInt16(channel) < RMS_SILENCE_THRESHOLD) continue; // this side was silent
        const text = await this.transcribe(channel, this.lastText[who]);
        if (text) {
          this.lastText[who] = text;
          this.events.onSegment({ t, text, who });
        }
      }
    } catch (err: any) {
      this.events.onStatus('warning', `Transcription error: ${err.message}`);
    } finally {
      this.busy = false;
      // audio may have accumulated past a chunk while whisper ran
      if (!this.stopping && this.pendingBytes >= CHUNK_SECONDS * SAMPLE_RATE * 4) {
        void this.flushChunk(false);
      }
    }
  }

  private transcribe(audio: Buffer, context: string): Promise<string> {
    const wavPath = path.join(os.tmpdir(), `og-chunk-${Date.now()}.wav`);
    const numSamples = Math.floor(audio.length / 2);
    fs.writeFileSync(wavPath, Buffer.concat([wavHeader(numSamples), audio]));
    const args = ['-m', MODEL, '-f', wavPath, '-nt', '-t', '4'];
    if (context) args.push('--prompt', context.slice(-200));
    return new Promise((resolve, reject) => {
      execFile(whisperBin(), args, { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        try {
          fs.unlinkSync(wavPath);
        } catch {}
        if (err) return reject(err);
        let text = stdout.trim();
        for (const p of HALLUCINATION_PATTERNS) text = text.replace(p, '');
        text = text.replace(/\s+/g, ' ').trim();
        resolve(text);
      });
    });
  }
}
