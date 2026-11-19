'use client';
// Everything that can go into the knowledge base or become a draft page: a file, a web link or pasted text.

import { extractFile, htmlToDoc, kindOf } from './extract';
import type { KbDocument } from '../types';

export type SourceInput =
  | { type: 'doc'; doc: KbDocument } // already read (e.g. a link checked in the add dialog)
  | { type: 'file'; file: File }
  | { type: 'link'; url: string }
  | { type: 'text'; title: string; text: string };

export const sourceLabel = (s: SourceInput) =>
  s.type === 'doc' ? s.doc.name : s.type === 'file' ? s.file.name : s.type === 'link' ? s.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80) : s.title || 'Pasted text';

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Untitled';

export async function sourceToDoc(src: SourceInput, id: string): Promise<KbDocument> {
  if (src.type === 'doc') return { ...src.doc, id };
  if (src.type === 'file') return extractFile(src.file, id);
  if (src.type === 'text') {
    const text = src.text.replace(/\r\n?/g, '\n').trim();
    if (text.length < 20) throw new Error('The pasted text is empty or too short.');
    const name = `${safeName(src.title || text.split('\n')[0].slice(0, 60))}.txt`;
    return { id, name, size: text.length, kind: 'text', text, quality: { chars: text.length, lowTextPages: [] } };
  }
  return fetchLinkDoc(src.url, id, true);
}

/** Download a link through the server (no CORS), then read it here like an upload. */
async function fetchLinkDoc(url: string, id: string, mayFollowPdf: boolean): Promise<KbDocument> {
  const res = await fetch('/api/fetch-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(d.error ?? `Could not add the link (${res.status}).`);
  }
  const finalUrl = res.headers.get('x-final-url') ?? url;
  const shown = res.headers.get('x-original-url') ?? url;
  const headerName = res.headers.get('x-filename');
  const fromName = headerName ? decodeURIComponent(headerName) : decodeURIComponent(new URL(finalUrl).pathname.split('/').filter(Boolean).pop() ?? 'page');

  if (/html|xml/i.test(type) && !/pdf/i.test(type)) {
    const { title, text, pdfLinks } = htmlToDoc(await res.text(), finalUrl);
    // A short landing page that links its main document (FDA guidance pages): take the document.
    if (mayFollowPdf && text.length < 6000 && pdfLinks.length) {
      try {
        const pdf = await fetchLinkDoc(pdfLinks[0], id, false);
        return { ...pdf, name: `${safeName(title)}.pdf`, title, sourceUrl: pdfLinks[0], summary: `Main document linked from ${shown}` };
      } catch {
        // fall back to the page text
      }
    }
    if (text.length < 300) {
      throw new Error(
        'That page has almost no readable text. It may need JavaScript, sit behind a bot check or a login, or only list other pages. Download the document and upload it, or paste its text.',
      );
    }
    return {
      id,
      name: `${safeName(title)}.md`,
      size: text.length,
      kind: 'web',
      text,
      title,
      sourceUrl: shown,
      quality: { chars: text.length, lowTextPages: [], note: text.length < 3000 ? 'Short page: it may be a summary or a table of contents. Link the full text if there is one.' : undefined },
    };
  }

  // Files behind links: PDF, Word, Excel, CSV or plain text, read exactly like uploads.
  const blob = await res.blob();
  let name = fromName;
  if (!kindOf(name)) {
    const ext = /pdf/i.test(type) ? 'pdf' : /wordprocessingml/i.test(type) ? 'docx' : /spreadsheetml/i.test(type) ? 'xlsx' : /csv/i.test(type) ? 'csv' : 'txt';
    name = `${safeName(name.replace(/\.[a-z0-9]+$/i, '')) || 'download'}.${ext}`;
  }
  const doc = await extractFile(new File([blob], name, { type }), id);
  return { ...doc, sourceUrl: shown };
}
