// Minimal markdown -> HTML for enhanced notes (headers, lists, bold/italic/code, checkboxes, quotes)
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (inList) {
      out.push(`</${inList}>`);
      inList = null;
    }
  };
  for (const raw of lines) {
    const line = escapeHtml(raw.trimEnd());
    const h = line.match(/^(#{1,4})\s+(.*)/);
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    const bq = line.match(/^\s*&gt;\s?(.*)/);
    if (h) {
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
    } else if (ul) {
      if (inList !== 'ul') {
        closeList();
        out.push('<ul>');
        inList = 'ul';
      }
      const cb = ul[1].match(/^\[([ xX-])\]\s*(.*)/);
      if (cb) {
        const checked = cb[1] === 'x' || cb[1] === 'X' ? ' checked' : '';
        out.push(`<li class="task"><input type="checkbox" disabled${checked}> ${inline(cb[2])}</li>`);
      } else {
        out.push(`<li>${inline(ul[1])}</li>`);
      }
    } else if (ol) {
      if (inList !== 'ol') {
        closeList();
        out.push('<ol>');
        inList = 'ol';
      }
      out.push(`<li>${inline(ol[1])}</li>`);
    } else if (bq) {
      closeList();
      out.push(`<blockquote>${inline(bq[1])}</blockquote>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}
