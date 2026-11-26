// Shared by the scripts that run the real engine outside the browser (demo-case, build-seed).
// Mirrors src/lib/client/extract.ts (reading files) and src/lib/client/build.ts (sorting, rules, criteria).
import { readFileSync } from 'node:fs';
import { extractRules, groupCategories, writeCriteria } from '../../src/lib/server/pipeline.ts';
import { llmObject } from '../../src/lib/server/ai.ts';
import { CLASSIFY_SYSTEM, classifySchema } from '../../src/lib/server/prompts.ts';
import { splitDocument } from '../../src/lib/text.ts';
import { SOURCE_ROLES, type DocRole, type DroppedRequirement, type Requirement } from '../../src/lib/types.ts';

export interface EngineDoc {
  id: string;
  name: string;
  kind: string;
  text: string;
  role?: DocRole;
}

export const tidy = (s: string) => s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();

/** A file as the browser reads it: PDFs with "[Page N]" markers, DOCX raw text, text files tidied. */
export async function readDoc(file: string): Promise<{ text: string; pages?: number; low: number[] }> {
  const ext = file.toLowerCase().split('.').pop();
  if (ext === 'pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true, isEvalSupported: false });
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
      if (text.replace(/\s/g, '').length < 40 && (p < doc.numPages || low.length === p - 1)) low.push(p);
      parts.push(`[Page ${p}]\n${text}`);
    }
    const n = doc.numPages;
    await task.destroy();
    return { text: parts.join('\n\n'), pages: n, low };
  }
  if (ext === 'docx') {
    const mammoth = (await import('mammoth')).default;
    return { text: tidy((await mammoth.extractRawText({ path: file })).value), low: [] };
  }
  return { text: tidy(readFileSync(file, 'utf8').replace(/^﻿/, '')), low: [] };
}

export async function pool<T, R>(xs: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (next < xs.length) { const i = next++; out[i] = await fn(xs[i], i); } }));
  return out;
}

/** Step 2 of the build: the same call as /api/analyze/classify. Role, title and summary per document id. */
export async function classifyDocs(description: string, docs: EngineDoc[]): Promise<Record<string, { role: DocRole; title?: string; summary?: string }>> {
  const files = docs
    .map((d) => `<file id="${d.id}" name="${d.name.replace(/"/g, "'").slice(0, 200)}" type="${d.kind}" characters="${d.text.length}">\n${d.text.slice(0, 5000)}${d.text.length > 7000 ? `\n[...]\n${d.text.slice(-1200)}` : ''}\n</file>`)
    .join('\n\n');
  const cls = await llmObject({ tier: 'fast', system: CLASSIFY_SYSTEM, prompt: `The user is writing: ${description || '(not stated)'}\n\nFiles (start and end of each):\n\n${files}\n\nReturn every file id exactly once.`, schema: classifySchema, maxOutputTokens: 6000 });
  return Object.fromEntries(
    docs.map((d) => {
      const x = cls.documents.find((y) => y.id === d.id);
      return [d.id, { role: x?.role ?? 'other', title: x?.title, summary: x?.summary }];
    }),
  );
}

/** Steps 3 and 4 of the build (src/lib/client/build.ts buildRequirements): rules per document part, groups, criteria. */
export async function buildRules(
  docs: EngineDoc[],
  ctx: { name: string; description: string },
  log: (s: string) => void = () => {},
): Promise<{ rules: Requirement[]; categories: string[]; dropped: DroppedRequirement[] }> {
  const sources = docs.filter((d) => d.role && SOURCE_ROLES.includes(d.role));
  if (!sources.length) throw new Error('No rule documents.');
  const otherDocs = docs.filter((d) => !sources.includes(d)).map((d) => `${d.name} (${d.role})`);
  const jobs = sources.flatMap((d) => { const parts = splitDocument(d.text); return parts.map((p, i) => ({ d, p, n: i + 1, of: parts.length })); });
  const per = await pool(jobs, 6, (j) => extractRules({ id: j.d.id, name: j.d.name, text: j.p.text }, { name: ctx.name, description: ctx.description, otherDocs, part: { n: j.n, of: j.of, offset: j.p.offset } }));
  let rules = per.flatMap((p) => p.rules);
  const dropped = per.flatMap((p) => p.dropped);
  const counts: Record<string, number> = {};
  for (const r of rules) counts[r.category] = (counts[r.category] ?? 0) + 1;
  let categories = Object.keys(counts);
  try {
    const g = await groupCategories(categories, counts);
    rules = rules.map((r) => ({ ...r, category: g.map[r.category] ?? r.category }));
    categories = g.order.filter((x) => rules.some((r) => r.category === x));
  } catch (err) {
    log(`grouping failed: ${(err as Error).message}`);
  }
  rules = categories.flatMap((x) => rules.filter((r) => r.category === x));
  rules.forEach((r, i) => (r.id = `R${i + 1}`));
  log(`rules: ${rules.length} in ${categories.length} groups from ${jobs.length} parts; ${dropped.length} dropped`);
  const batches: Requirement[][] = [];
  for (let i = 0; i < rules.length; i += 6) batches.push(rules.slice(i, i + 6));
  let failed = 0;
  const done = await pool(batches, 8, async (b) => {
    for (let a = 0; a < 2; a++) {
      try { return await writeCriteria(b, { description: ctx.description }); } catch { /* retry once */ }
    }
    failed += b.length;
    return b;
  });
  log(`criteria written${failed ? `; ${failed} rules without criteria (title/summary fallback)` : ''}`);
  return { rules: done.flat(), categories, dropped };
}
