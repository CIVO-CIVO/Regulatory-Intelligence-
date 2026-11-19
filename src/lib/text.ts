// Text utilities shared by client and server: quote verification, draft sections, ranking.

/** Normalise text for matching and keep a map back to original offsets. */
export function normalizeWithMap(src: string): { norm: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < src.length; i++) {
    let ch = src[i];
    // Hyphenation at a line break: "exu-\n  date" -> "exudate"
    if (ch === '-' && /[a-z]/i.test(src[i - 1] ?? '')) {
      let j = i + 1;
      while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++;
      if (src[j] === '\n' || src[j] === '\r') {
        while (j < src.length && /\s/.test(src[j])) j++;
        if (/[a-z]/.test(src[j] ?? '')) {
          i = j - 1;
          continue;
        }
      }
    }
    if (ch === '­') continue; // soft hyphen
    if (/[‘’‚′`]/.test(ch)) ch = "'";
    else if (/[“”„″]/.test(ch)) ch = '"';
    else if (/[‐-―−]/.test(ch)) ch = '-';
    else if (ch === 'ﬁ') ch = 'fi';
    else if (ch === 'ﬂ') ch = 'fl';
    else if (ch === '§') ch = '§';
    if (/\s/.test(ch)) {
      if (lastSpace) continue;
      out.push(' ');
      map.push(i);
      lastSpace = true;
      continue;
    }
    const lower = ch.toLowerCase();
    for (const c of lower) {
      out.push(c);
      map.push(i);
    }
    lastSpace = false;
  }
  return { norm: out.join(''), map };
}

function normalize(s: string): string {
  return normalizeWithMap(s).norm.trim();
}

export interface Located {
  start: number;
  end: number;
  text: string;
  match: 'exact' | 'fuzzy';
}

/**
 * Find a quotation inside a document. Exact after normalisation, or a fuzzy window anchored
 * on the first and last words when the model changed a few characters. Returns null when the
 * quote is not in the document: such a quote is never shown or sent as a citation.
 */
export function locateQuote(docText: string, quote: string): Located | null {
  const q = normalize(quote.replace(/\s*(\.\.\.|…)\s*/g, ' '));
  if (q.length < 12) return null;
  const { norm, map } = normalizeWithMap(docText);
  const at = norm.indexOf(q);
  if (at >= 0) {
    const start = map[at];
    const end = map[at + q.length - 1] + 1;
    return { start, end, text: docText.slice(start, end), match: 'exact' };
  }
  const words = q.split(' ').filter(Boolean);
  if (words.length < 8) return null;
  const k = Math.min(6, Math.floor(words.length / 3));
  const tryAnchors = (offsets: number[]): Located | null => {
    for (const off of offsets) {
      const head = words.slice(off, off + k).join(' ');
      let from = norm.indexOf(head);
      while (from >= 0) {
        for (const endOff of [0, 1, 2]) {
          const tailWords = words.slice(words.length - k - endOff, words.length - endOff);
          const tail = tailWords.join(' ');
          const tailAt = norm.indexOf(tail, from + head.length);
          if (tailAt < 0) continue;
          const span = tailAt + tail.length - from;
          if (span > q.length * 1.35 || span < q.length * 0.6) continue;
          const windowText = norm.slice(from, tailAt + tail.length);
          if (wordOverlap(windowText, q) < 0.85) continue;
          const start = map[from];
          const end = map[tailAt + tail.length - 1] + 1;
          return { start, end, text: docText.slice(start, end), match: 'fuzzy' };
        }
        from = norm.indexOf(head, from + 1);
      }
    }
    return null;
  };
  return tryAnchors([0, 1, 2]);
}

function wordOverlap(a: string, b: string): number {
  const wa = a.split(' ');
  const wb = new Map<string, number>();
  for (const w of b.split(' ')) wb.set(w, (wb.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of wa) {
    const n = wb.get(w) ?? 0;
    if (n > 0) {
      hit++;
      wb.set(w, n - 1);
    }
  }
  return hit / Math.max(wa.length, b.split(' ').length);
}

/** The PDF page a character offset falls on, from "[Page N]" markers. */
export function pageAt(docText: string, offset: number): number | undefined {
  const re = /\[Page (\d+)\]/g;
  let page: number | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(docText)) && m.index <= offset) page = Number(m[1]);
  return page;
}

export function countWords(s: string): number {
  const m = s.match(/[\p{L}\p{N}][\p{L}\p{N}'’.,/-]*/gu);
  return m ? m.length : 0;
}

export interface DraftSection {
  heading: string;
  text: string;
  start: number;
  end: number;
}

const looksLikeHeading = (line: string) => {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  if (/[.;,]$/.test(t)) return false;
  if (/^#{1,6}\s/.test(t)) return true;
  return countWords(t) <= 10;
};

/**
 * Split the draft into sections: blocks separated by blank lines; a short first line without
 * closing punctuation is the heading. A heading alone in its block heads the next block.
 */
export function splitSections(draft: string): DraftSection[] {
  const blocks: { text: string; start: number; end: number }[] = [];
  const re = /\n\s*\n/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(draft))) {
    blocks.push({ text: draft.slice(last, m.index), start: last, end: m.index });
    last = m.index + m[0].length;
  }
  blocks.push({ text: draft.slice(last), start: last, end: draft.length });

  const sections: DraftSection[] = [];
  let pendingHeading: { text: string; start: number } | null = null;
  for (const b of blocks) {
    const raw = b.text;
    if (!raw.trim()) continue;
    const lines = raw.split('\n');
    const first = lines[0];
    if (lines.length === 1 && looksLikeHeading(first) && !pendingHeading) {
      pendingHeading = { text: first.replace(/^#{1,6}\s*/, '').trim(), start: b.start };
      continue;
    }
    let heading = '';
    let body = raw;
    if (lines.length > 1 && looksLikeHeading(first)) {
      heading = first.replace(/^#{1,6}\s*/, '').trim();
      body = lines.slice(1).join('\n');
    }
    if (pendingHeading) {
      if (heading) body = `${heading}\n${body}`;
      heading = pendingHeading.text;
    }
    sections.push({
      heading,
      text: body.trim(),
      start: pendingHeading ? pendingHeading.start : b.start,
      end: b.end,
    });
    pendingHeading = null;
  }
  if (pendingHeading) {
    sections.push({ heading: pendingHeading.text, text: '', start: pendingHeading.start, end: draft.length });
  }
  return sections.flatMap(splitLarge);
}

const PART_CHARS = 2500;

/**
 * Text pasted from Word often has single line breaks only, which makes one huge "section".
 * Split oversized sections into parts on line breaks (or sentences) so ranking can pick the
 * relevant parts instead of sending only the beginning of the draft.
 */
function splitLarge(s: DraftSection): DraftSection[] {
  if (s.text.length <= PART_CHARS * 1.5) return [s];
  const units = s.text.split(/\n+/).flatMap((line) => (line.length > PART_CHARS ? line.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [line] : [line]));
  const parts: string[] = [];
  let buf = '';
  for (const u of units) {
    if (buf && buf.length + u.length > PART_CHARS) {
      parts.push(buf.trim());
      buf = '';
    }
    buf += (buf ? '\n' : '') + u;
  }
  if (buf.trim()) parts.push(buf.trim());
  const base = s.heading || 'Untitled section';
  return parts.map((text, i) => ({ heading: `${base} (part ${i + 1} of ${parts.length})`, text, start: s.start, end: s.end }));
}

const STOP = new Set(
  'a an and are as at be by for from has have in is it its of on or that the this to was were will with which shall must should may any each all not no their there these those such than then other into upon under when where who whom device submission draft report state states stated include includes including'.split(
    ' ',
  ),
);

export function keywords(s: string): string[] {
  return (normalize(s).match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w));
}

/**
 * Pick the draft sections Jev should see. Short drafts go in whole; long drafts are ranked by
 * keyword overlap with the requirement and cut to the budget, keeping the original order.
 */
export function selectSections(sections: DraftSection[], query: string, budgetChars = 20000): DraftSection[] {
  const total = sections.reduce((n, s) => n + s.heading.length + s.text.length, 0);
  if (total <= budgetChars) return sections;
  const q = new Set(keywords(query));
  const scored = sections.map((s, i) => {
    const words = keywords(`${s.heading} ${s.heading} ${s.text}`);
    let hit = 0;
    for (const w of words) if (q.has(w)) hit++;
    const score = hit / Math.sqrt(words.length + 4);
    return { s, i, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked: typeof scored = [];
  let used = 0;
  for (const c of scored) {
    const len = c.s.heading.length + c.s.text.length;
    if (used + len > budgetChars) {
      // Shorten a relevant section to the space left instead of skipping it.
      const room = budgetChars - used - c.s.heading.length;
      if (c.score > 0 && room > 400) {
        picked.push({ ...c, s: { ...c.s, text: `${c.s.text.slice(0, room)} [cut]` } });
        used = budgetChars;
      }
      continue;
    }
    picked.push(c);
    used += len;
  }
  return picked.sort((a, b) => a.i - b.i).map((c) => c.s);
}

/** Small stable hash for cache keys. */
export function hash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}
