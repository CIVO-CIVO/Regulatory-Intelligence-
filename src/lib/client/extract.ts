'use client';
// Text extraction runs in the browser, so files never have to be uploaded whole to the server.

import type { DocKind, KbDocument } from '../types';

export const ACCEPT = '.pdf,.docx,.xlsx,.csv,.txt,.md,.text,.json,.xml,.html,.htm';

const LOW_TEXT_PAGE = 40; // characters: below this a PDF page is treated as scanned / image only

export function kindOf(name: string): DocKind | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'xlsx') return 'xlsx';
  if (ext === 'csv') return 'csv';
  if (['txt', 'md', 'text', 'json', 'xml', 'html', 'htm'].includes(ext)) return 'text';
  return null;
}

export async function extractFile(file: File, id: string): Promise<KbDocument> {
  const kind = kindOf(file.name);
  if (!kind) throw new Error(`${file.name}: this file type is not supported (use PDF, DOCX, XLSX, CSV or text).`);
  const base = { id, name: file.name, size: file.size, kind };
  if (kind === 'pdf') return { ...base, ...(await fromPdf(file)) };
  if (kind === 'docx') {
    const mammoth = (await import('mammoth')).default;
    const res = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    const text = tidy(res.value);
    return { ...base, text, quality: { chars: text.length, lowTextPages: [], note: text.length < 50 ? 'Almost no text found.' : undefined } };
  }
  if (kind === 'xlsx') {
    const text = await fromXlsx(await file.arrayBuffer());
    return { ...base, text, quality: { chars: text.length, lowTextPages: [] } };
  }
  let text = await file.text();
  if (/\.html?$/i.test(file.name)) text = new DOMParser().parseFromString(text, 'text/html').body.innerText;
  text = tidy(text);
  return { ...base, text, quality: { chars: text.length, lowTextPages: [] } };
}

function tidy(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

async function fromPdf(file: File): Promise<Pick<KbDocument, 'text' | 'quality'>> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const parts: string[] = [];
  const low: number[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let text = '';
    let lastY: number | null = null;
    for (const item of content.items as { str?: string; transform?: number[]; hasEOL?: boolean }[]) {
      if (typeof item.str !== 'string') continue;
      const y = item.transform?.[5] ?? null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !text.endsWith('\n')) text += '\n';
      text += item.str;
      if (item.hasEOL) text += '\n';
      lastY = y;
    }
    text = tidy(text);
    if (text.replace(/\s/g, '').length < LOW_TEXT_PAGE) low.push(p);
    parts.push(`[Page ${p}]\n${text}`);
    page.cleanup();
  }
  await task.destroy();
  const text = parts.join('\n\n');
  const note =
    low.length === doc.numPages
      ? 'No text layer: this looks like a scanned PDF. Its content cannot be read automatically.'
      : low.length
        ? `${low.length} page(s) have no readable text (scans, images or figures).`
        : undefined;
  return { text, quality: { chars: text.length, pages: doc.numPages, lowTextPages: low, note } };
}

async function fromXlsx(buf: ArrayBuffer): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(buf));
  const parse = (name: string) => (files[name] ? new DOMParser().parseFromString(strFromU8(files[name]), 'application/xml') : null);
  const shared: string[] = [];
  const ss = parse('xl/sharedStrings.xml');
  ss?.querySelectorAll('si').forEach((si) => shared.push(Array.from(si.querySelectorAll('t')).map((t) => t.textContent ?? '').join('')));
  const wb = parse('xl/workbook.xml');
  const names = wb ? Array.from(wb.querySelectorAll('sheet')).map((s) => s.getAttribute('name') ?? 'Sheet') : [];
  const sheetFiles = Object.keys(files)
    .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const out: string[] = [];
  sheetFiles.forEach((f, i) => {
    const doc = parse(f)!;
    const rows: string[] = [];
    doc.querySelectorAll('sheetData row').forEach((row) => {
      const cells = Array.from(row.querySelectorAll('c')).map((c) => {
        const t = c.getAttribute('t');
        const v = c.querySelector('v')?.textContent ?? '';
        if (t === 's') return shared[Number(v)] ?? '';
        if (t === 'inlineStr') return c.querySelector('is t')?.textContent ?? '';
        return v;
      });
      if (cells.some((x) => x.trim())) rows.push(cells.join(' | '));
    });
    out.push(`[Sheet: ${names[i] ?? `Sheet ${i + 1}`}]\n${rows.join('\n')}`);
  });
  return tidy(out.join('\n\n'));
}
