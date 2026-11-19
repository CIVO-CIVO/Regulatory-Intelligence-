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
  let text = decodeText(await file.arrayBuffer());
  if (/\.html?$/i.test(file.name)) text = htmlToText(text);
  text = tidy(text);
  return { ...base, text, quality: { chars: text.length, lowTextPages: [] } };
}

/** UTF-8 first; files saved by older Windows tools are often Windows-1252 (µ, ±, °, ≤ would be lost). */
function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\ufeff/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript, template, svg').forEach((n) => n.remove());
  doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
  doc.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article, table, blockquote, pre').forEach((n) => {
    n.append('\n');
  });
  doc.querySelectorAll('td, th').forEach((n) => n.append(' | '));
  return doc.body?.textContent ?? '';
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
    // A short final page (end of a section) is normal; only flag it if the whole file lacks text.
    if (text.replace(/\s/g, '').length < LOW_TEXT_PAGE && (p < doc.numPages || low.length === p - 1)) low.push(p);
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
  parse('xl/sharedStrings.xml')
    ?.querySelectorAll('si')
    .forEach((si) => shared.push(Array.from(si.querySelectorAll('t')).map((t) => t.textContent ?? '').join('')));
  // Sheet names map to sheet files through the workbook relationships, not by position.
  const rels = new Map<string, string>();
  parse('xl/_rels/workbook.xml.rels')
    ?.querySelectorAll('Relationship')
    .forEach((r) => rels.set(r.getAttribute('Id') ?? '', (r.getAttribute('Target') ?? '').replace(/^\/?(xl\/)?/, 'xl/')));
  const sheets = Array.from(parse('xl/workbook.xml')?.querySelectorAll('sheet') ?? []).map((sh, i) => ({
    name: sh.getAttribute('name') ?? `Sheet ${i + 1}`,
    file: rels.get(sh.getAttribute('r:id') ?? sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? '') ?? `xl/worksheets/sheet${i + 1}.xml`,
  }));
  const colIndex = (ref: string | null, fallback: number) => {
    const letters = ref?.match(/^[A-Z]+/)?.[0];
    if (!letters) return fallback;
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  const out: string[] = [];
  for (const sheet of sheets) {
    const doc = parse(sheet.file);
    if (!doc) continue;
    const rows: string[] = [];
    doc.querySelectorAll('sheetData row').forEach((row) => {
      const cells: string[] = [];
      Array.from(row.querySelectorAll('c')).forEach((c, i) => {
        const t = c.getAttribute('t');
        const v = c.querySelector('v')?.textContent ?? '';
        const value = t === 's' ? (shared[Number(v)] ?? '') : t === 'inlineStr' ? (c.querySelector('is t')?.textContent ?? '') : v;
        cells[colIndex(c.getAttribute('r'), i)] = value; // blank cells keep their column
      });
      const line = Array.from(cells, (x) => x ?? '').join(' | ');
      if (line.replace(/[|\s]/g, '')) rows.push(line);
    });
    out.push(`[Sheet: ${sheet.name}]\n${rows.join('\n')}`);
  }
  return tidy(out.join('\n\n'));
}

// ------------------------------------------------------------ web pages

const JUNK = 'script, style, noscript, template, svg, iframe, form, button, input, select, nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo], [aria-hidden=true], .breadcrumb, .breadcrumbs, .skip-link, .visually-hidden, .sr-only, .cookie, .cookies, #cookie-banner';
const MAIN = 'main, article, [role=main], #main-content, #main, #content, .main-content, .content, #fulltext_content_area, .body-content, .field--name-body';
const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'DL', 'DT', 'DD', 'TABLE', 'FIGURE', 'FIGCAPTION', 'ADDRESS', 'HR']);

/** A web page as readable text: main content only, headings as "#" lines, lists as "-", table rows as "a | b". */
export function htmlToDoc(html: string, baseUrl: string): { title: string; text: string; pdfLinks: string[] } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = doc.querySelector('meta[property="og:title"]')?.getAttribute('content');
  const title = (meta || doc.title || doc.querySelector('h1')?.textContent || new URL(baseUrl).hostname).replace(/\s+/g, ' ').trim();
  // Links to the page's main file (e.g. FDA guidance pages: "Download the Final Guidance Document").
  const pdfLinks = Array.from(doc.querySelectorAll('a[href]'))
    .map((a) => ({ href: a.getAttribute('href') ?? '', label: (a.textContent ?? '').trim() }))
    .filter((a) => /\.pdf($|\?)|\/media\/\d+\/download/i.test(a.href))
    .sort((a, b) => Number(/download|guidance|full text|pdf/i.test(b.label)) - Number(/download|guidance|full text|pdf/i.test(a.label)))
    .map((a) => {
      try {
        return new URL(a.href, baseUrl).toString();
      } catch {
        return '';
      }
    })
    .filter((u, i, all) => u && all.indexOf(u) === i);
  doc.querySelectorAll(JUNK).forEach((n) => n.remove());
  const candidates = Array.from(doc.querySelectorAll<HTMLElement>(MAIN));
  const best = candidates.sort((a, b) => (b.textContent?.length ?? 0) - (a.textContent?.length ?? 0))[0];
  const root = best && (best.textContent?.length ?? 0) > 500 ? best : doc.body;
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      out.push((node.textContent ?? '').replace(/\s+/g, ' '));
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) {
      out.push(`\n\n${'#'.repeat(Number(tag[1]))} ${(el.textContent ?? '').replace(/\s+/g, ' ').trim()}\n\n`);
      return;
    }
    if (tag === 'BR') return void out.push('\n');
    if (tag === 'LI') out.push('\n- ');
    if (tag === 'TR') {
      const cells = Array.from(el.children).map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim());
      out.push(`\n${cells.join(' | ')}`);
      return;
    }
    if (BLOCK.has(tag)) out.push('\n\n');
    el.childNodes.forEach(walk);
    if (BLOCK.has(tag)) out.push('\n\n');
  };
  walk(root);
  const text = tidy(
    out
      .join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n'),
  );
  return { title, text, pdfLinks };
}
