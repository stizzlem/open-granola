import { Meeting } from './types';
import { getTemplate } from './templates';

const OLLAMA_URL = 'http://localhost:11434';
const MODEL = 'llama3.1:latest';

export async function checkOllama(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, error: `Ollama responded with HTTP ${res.status}` };
    const data = (await res.json()) as { models?: { name: string }[] };
    const names = (data.models ?? []).map((m) => m.name);
    if (!names.includes(MODEL)) {
      return { ok: false, error: `Model ${MODEL} not found. Run: ollama pull ${MODEL.replace(':latest', '')}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Ollama is not running. Install it from https://ollama.com and run: ollama serve (or open the Ollama app), then: ollama pull llama3.1' };
  }
}

async function chatCompletion(system: string, user: string, maxSeconds = 300): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      options: { num_ctx: 16384, temperature: 0.3 },
    }),
    signal: AbortSignal.timeout(maxSeconds * 1000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content?.trim() ?? '';
}

function transcriptText(meeting: Meeting): string {
  return meeting.transcript
    .map((s) => {
      const mm = Math.floor(s.t / 60);
      const ss = String(s.t % 60).padStart(2, '0');
      const who = s.who === 'me' ? 'Me: ' : s.who === 'them' ? 'Them: ' : '';
      return `[${mm}:${ss}] ${who}${s.text}`;
    })
    .join('\n');
}

export async function enhance(meeting: Meeting): Promise<string> {
  const template = getTemplate(meeting.template);
  const system = `You turn raw meeting transcripts plus the attendee's own sparse notes into clean, structured meeting notes in Markdown.
Rules:
- Use ONLY information from the transcript and the user's notes. Never invent facts, numbers, names, or commitments.
- Quote exact figures (prices, dates, quantities) as said in the transcript.
- Transcript lines prefixed "Me:" were spoken by the note-taker; "Them:" by the other participant(s). Use this for attribution.
- Where the user's sparse note fragments relate to something in the transcript, expand them and back them with a short supporting quote from the transcript (in "quotes").
- Attribute action items to people by name when the transcript makes the owner clear.
- Be concise. No preamble, no closing remarks — output only the Markdown notes.
${template.structure}`;
  const user = `Meeting title: ${meeting.title}

MY SPARSE NOTES (typed during the meeting; may be fragments):
${meeting.notes.trim() || '(none)'}

FULL TRANSCRIPT:
${transcriptText(meeting) || '(empty transcript)'}`;
  return chatCompletion(system, user);
}

export async function chatAboutTranscript(meeting: Meeting, question: string): Promise<string> {
  const system = `You answer questions about a meeting, using its transcript (which may still be in progress) and the attendee's notes.
Rules:
- Answer from the transcript/notes only. If the answer isn't in there, say so plainly.
- Be direct and brief — a few sentences at most, unless asked to summarize at length.
- Quote exact figures and names as said. Timestamps like [1:23] tell you when things were said; "the last few minutes" means the highest timestamps.
- Lines prefixed "Me:" were spoken by the person asking you questions; "Them:" by the other meeting participant(s).`;
  const history = meeting.chat
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Q' : 'A'}: ${m.text}`)
    .join('\n');
  const user = `TRANSCRIPT SO FAR:
${transcriptText(meeting) || '(no speech captured yet)'}

MY NOTES:
${meeting.notes.trim() || '(none)'}
${history ? `\nPREVIOUS Q&A:\n${history}\n` : ''}
QUESTION: ${question}`;
  return chatCompletion(system, user, 120);
}
