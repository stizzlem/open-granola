import * as fs from 'fs';
import * as path from 'path';
import { Meeting } from './types';
import { getSettings } from './settings';

function two(n: number): string {
  return String(n).padStart(2, '0');
}

export function meetingToMarkdown(m: Meeting): string {
  const d = new Date(m.createdAt);
  const date = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
  const lines: string[] = [
    '---',
    `title: "${m.title.replace(/"/g, "'")}"`,
    `date: ${date}`,
    `template: ${m.template}`,
    'tags: [meeting, opengranola]',
    '---',
    '',
  ];
  if (m.notes.trim()) {
    lines.push('## My notes', '', m.notes.trim(), '');
  }
  if (m.enhanced.trim()) {
    lines.push('## Enhanced notes', '', m.enhanced.trim(), '');
  }
  if (m.chat.length > 0) {
    lines.push('## Q&A', '');
    for (const c of m.chat) {
      lines.push(c.role === 'user' ? `**Q:** ${c.text}` : `**A:** ${c.text}`, '');
    }
  }
  if (m.transcript.length > 0) {
    lines.push('## Transcript', '');
    for (const s of m.transcript) {
      const t = `${Math.floor(s.t / 60)}:${two(s.t % 60)}`;
      const who = s.who === 'me' ? '**Me**' : s.who === 'them' ? '**Them**' : '';
      lines.push(`- ${t} ${who} ${s.text}`.replace(/\s+/g, ' '));
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Write/update the meeting's markdown file in the configured Obsidian folder.
 *  Returns the file path written, or null if export is not configured. */
export function exportToObsidian(m: Meeting): string | null {
  const dir = getSettings().obsidianDir;
  if (!dir) return null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date(m.createdAt);
    const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
    const safeTitle = m.title.replace(/[/\\:#|^\[\]?"*<>]/g, '').trim() || 'Untitled meeting';
    const file = path.join(dir, `${stamp} ${safeTitle}.md`);
    // meeting was renamed: remove the previously exported file
    if (m.exportFile && m.exportFile !== file) {
      try {
        fs.unlinkSync(m.exportFile);
      } catch {}
    }
    fs.writeFileSync(file, meetingToMarkdown(m));
    return file;
  } catch {
    return null; // export must never break saving
  }
}
