// Demo-case harness: runs a bundled example case (public/examples/<case>/case.json) through the real engine,
// reading its files the way the browser does, then applies the case's demo edits one by one and shows how the
// ratings move. Use it to prove every demo step before shipping a case.
//
//   set -a; . ~/.config/regulatory-intelligence/secrets.env; set +a
//   ./node_modules/.bin/tsx --conditions=react-server scripts/demo-case.mts public/examples/<case> [--rebuild] [--no-demo]
//
// Rules are cached per case (DEMO_CACHE, default <tmp>/ri-demo-cache) so edits to pages and demo steps re-run fast.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractRules, groupCategories, writeCriteria, checkPage } from '../src/lib/server/pipeline.ts';
import { llmObject } from '../src/lib/server/ai.ts';
import { CLASSIFY_SYSTEM, classifySchema } from '../src/lib/server/prompts.ts';
import { selectFacts } from '../src/lib/rules.ts';
import { splitDocument, countWords, hash } from '../src/lib/text.ts';
import { SOURCE_ROLES, type DocRole, type Requirement, type RuleCheck } from '../src/lib/types.ts';

interface CaseFile { path: string; label: string; expectRole?: DocRole }
interface CasePage { title: string; path: string }
interface DemoStep { page: string; do: 'replace' | 'delete' | 'append' | 'insert-after'; find?: string; text?: string; say: string; expect?: string }
interface Case { id: string; name: string; description: string; files: CaseFile[]; pages: CasePage[]; demo?: DemoStep[] }

const dir = process.argv[2];
if (!dir) throw new Error('usage: demo-case.mts <case dir> [--rebuild] [--no-demo]');
const rebuild = process.argv.includes('--rebuild');
const noDemo = process.argv.includes('--no-demo');
const c: Case = JSON.parse(readFileSync(path.join(dir, 'case.json'), 'utf8'));
const cacheDir = process.env.DEMO_CACHE || path.join(os.tmpdir(), 'ri-demo-cache');
mkdirSync(cacheDir, { recursive: true });
const t0 = Date.now();
const secs = () => `${Math.round((Date.now() - t0) / 1000)} s`;

// ------------------------------------------------------------ read files like the browser (src/lib/client/extract.ts)
const tidy = (s: string) => s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
async function readDoc(file: string): Promise<{ text: string; pages?: number; low: number[] }> {
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

async function pool<T, R>(xs: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (next < xs.length) { const i = next++; out[i] = await fn(xs[i], i); } }));
  return out;
}

const docs = await Promise.all(
  c.files.map(async (f, i) => {
    const r = await readDoc(path.join(dir, f.path));
    return { id: `D${i + 1}`, name: f.label, kind: f.path.split('.').pop()!, text: r.text, expect: f.expectRole, low: r.low, pages: r.pages, role: undefined as DocRole | undefined };
  }),
);
console.log(`\n# ${c.name}\n${docs.map((d) => `  ${d.id} ${d.name}: ${d.text.length} chars${d.pages ? `, ${d.pages} pages` : ''}${d.low.length ? `, LOW TEXT pages ${d.low.join(',')}` : ''}`).join('\n')}`);

// ------------------------------------------------------------ build (cached)
const key = hash(JSON.stringify([c.description, docs.map((d) => [d.name, d.text])]));
const cacheFile = path.join(cacheDir, `${c.id}-${key}.json`);
let rules: Requirement[];
let dropped: { title: string; reason: string }[] = [];
let roles: Record<string, DocRole>;
if (!rebuild && existsSync(cacheFile)) {
  ({ rules, roles, dropped } = JSON.parse(readFileSync(cacheFile, 'utf8')));
  console.log(`rules from cache: ${rules.length}`);
} else {
  const files = docs
    .map((d) => `<file id="${d.id}" name="${d.name.replace(/"/g, "'").slice(0, 200)}" type="${d.kind}" characters="${d.text.length}">\n${d.text.slice(0, 5000)}${d.text.length > 7000 ? `\n[...]\n${d.text.slice(-1200)}` : ''}\n</file>`)
    .join('\n\n');
  const cls = await llmObject({ tier: 'fast', system: CLASSIFY_SYSTEM, prompt: `The user is writing: ${c.description || '(not stated)'}\n\nFiles (start and end of each):\n\n${files}\n\nReturn every file id exactly once.`, schema: classifySchema, maxOutputTokens: 6000 });
  roles = Object.fromEntries(docs.map((d) => [d.id, cls.documents.find((x) => x.id === d.id)?.role ?? 'other']));
  console.log(`sorted (${secs()}): ${docs.map((d) => `${d.id}=${roles[d.id]}`).join(' ')}`);
  const sources = docs.filter((d) => SOURCE_ROLES.includes(roles[d.id]));
  const otherDocs = docs.filter((d) => !sources.includes(d)).map((d) => `${d.name} (${roles[d.id]})`);
  const jobs = sources.flatMap((d) => { const parts = splitDocument(d.text); return parts.map((p, i) => ({ d, p, n: i + 1, of: parts.length })); });
  const per = await pool(jobs, 6, (j) => extractRules({ id: j.d.id, name: j.d.name, text: j.p.text }, { name: c.name, description: c.description, otherDocs, part: { n: j.n, of: j.of, offset: j.p.offset } }));
  rules = per.flatMap((p) => p.rules);
  dropped = per.flatMap((p) => p.dropped);
  const counts: Record<string, number> = {};
  for (const r of rules) counts[r.category] = (counts[r.category] ?? 0) + 1;
  let categories = Object.keys(counts);
  try {
    const g = await groupCategories(categories, counts);
    rules = rules.map((r) => ({ ...r, category: g.map[r.category] ?? r.category }));
    categories = g.order.filter((x) => rules.some((r) => r.category === x));
  } catch (err) {
    console.log(`grouping failed: ${(err as Error).message}`);
  }
  rules = categories.flatMap((x) => rules.filter((r) => r.category === x));
  rules.forEach((r, i) => (r.id = `R${i + 1}`));
  console.log(`rules (${secs()}): ${rules.length} in ${categories.length} groups from ${jobs.length} parts; ${dropped.length} dropped`);
  const batches: Requirement[][] = [];
  for (let i = 0; i < rules.length; i += 6) batches.push(rules.slice(i, i + 6));
  let failed = 0;
  const done = await pool(batches, 8, async (b) => {
    for (let a = 0; a < 2; a++) {
      try { return await writeCriteria(b, { description: c.description }); } catch { /* retry */ }
    }
    failed += b.length;
    return b;
  });
  rules = done.flat();
  console.log(`criteria (${secs()})${failed ? `: ${failed} rules without criteria` : ''}`);
  writeFileSync(cacheFile, JSON.stringify({ rules, roles, dropped }));
}
for (const d of docs) {
  d.role = roles[d.id];
  if (d.expect && d.expect !== d.role) console.log(`  !! ${d.id} ${d.name}: sorted as ${d.role}, expected ${d.expect}`);
}
const groups = [...new Set(rules.map((r) => r.category))];
console.log(`groups (${groups.length}): ${groups.map((g) => `${g} (${rules.filter((r) => r.category === g).length})`).join(' | ')}`);
if (dropped.length) console.log(`left out: ${dropped.map((d) => d.title).join('; ')}`);

// ------------------------------------------------------------ check pages
const evidence = docs.filter((d) => d.role === 'evidence').map((d) => ({ id: d.id, name: d.name, text: d.text }));
const docName = (id: string) => docs.find((d) => d.id === id)?.name ?? id;
const byId = new Map(rules.map((r) => [r.id, r]));
const pages = c.pages.map((p) => ({ title: p.title, text: readFileSync(path.join(dir, p.path), 'utf8').trim() }));
let jevCalls = 0;

async function check(title: string, text: string) {
  const facts = selectFacts(evidence, text).slice(0, 20);
  const res = await checkPage({ title, text }, rules, facts, docName);
  jevCalls += res.jevCalls;
  if (res.errors.length) console.log(`  !! Jev errors: ${res.errors.slice(0, 2).join(' | ')}`);
  return res.rules;
}

const tag = (x?: RuleCheck) => (!x || !x.relevant ? 'neutral' : x.error ? 'not checked' : `${x.conflict ? 'RED!' : x.tone.toUpperCase()} ${x.score ?? ''}`.trim());
function show(title: string, text: string, res: Record<string, RuleCheck>) {
  const rel = Object.values(res).filter((x) => x.relevant);
  const n = (t: string) => rel.filter((x) => x.tone === t).length;
  console.log(`\n== "${title}" (${countWords(text)} words): ${rel.length} relevant: ${n('green')} green, ${n('amber')} amber, ${n('red')} red`);
  const sev: Record<string, number> = { red: 0, amber: 1, green: 2, grey: 3 };
  for (const x of rel.sort((a, b) => sev[a.tone] - sev[b.tone] || (a.score ?? 0) - (b.score ?? 0))) {
    const r = byId.get(x.reqId)!;
    const p = x.probs ? ` [c ${(x.probs.complies ?? 0).toFixed(2)} m ${(x.probs.mostly ?? 0).toFixed(2)} u ${(x.probs.unclear ?? 0).toFixed(2)} x ${(x.probs.conflicts ?? 0).toFixed(2)} rel ${x.relevance.toFixed(2)}]` : '';
    console.log(`  ${tag(x).padEnd(11)} ${r.id.padEnd(4)} ${(r.section ?? '').padEnd(16)} ${r.title}  (${r.category})${p}`);
  }
}

const report: { case: string; rules: number; groups: string[]; pages: unknown[]; steps: unknown[] } = { case: c.id, rules: rules.length, groups, pages: [], steps: [] };
const results = await Promise.all(pages.map((p) => check(p.title, p.text)));
pages.forEach((p, i) => {
  show(p.title, p.text, results[i]);
  report.pages.push({ title: p.title, rules: Object.values(results[i]).filter((x) => x.relevant).map((x) => ({ id: x.reqId, title: byId.get(x.reqId)!.title, section: byId.get(x.reqId)!.section, tone: x.tone, score: x.score, conflict: !!x.conflict })) });
});

// ------------------------------------------------------------ demo steps, in order
if (!noDemo && c.demo?.length) {
  console.log('\n---------------- demo steps');
  for (const [i, s] of c.demo.entries()) {
    const pi = pages.findIndex((p) => p.title === s.page);
    if (pi < 0) throw new Error(`step ${i + 1}: no page "${s.page}"`);
    const before = pages[pi].text;
    const count = s.find ? before.split(s.find).length - 1 : 0;
    if (s.do !== 'append' && count !== 1) throw new Error(`step ${i + 1}: "find" occurs ${count} times on "${s.page}" (must be exactly once)`);
    let after = before;
    if (s.do === 'replace') after = before.replace(s.find!, s.text ?? '');
    if (s.do === 'delete') after = before.replace(s.find!, '').replace(/\n{3,}/g, '\n\n').trim();
    if (s.do === 'insert-after') after = before.replace(s.find!, `${s.find}${s.text}`);
    if (s.do === 'append') after = `${before}\n\n${s.text}`.trim();
    pages[pi].text = after;
    const prev = results[pi];
    const next = await check(s.page, after);
    results[pi] = next;
    const changes: string[] = [];
    for (const r of rules) {
      const a = prev[r.id];
      const b = next[r.id];
      if (tag(a) === tag(b)) continue;
      const big = (a?.relevant ?? false) !== (b?.relevant ?? false) || a?.tone !== b?.tone || !!a?.conflict !== !!b?.conflict || Math.abs((a?.score ?? 0) - (b?.score ?? 0)) >= 10;
      if (big) changes.push(`${r.id} ${r.section ?? ''} ${r.title}: ${tag(a)} -> ${tag(b)}`);
    }
    console.log(`\nStep ${i + 1} (${s.page}, ${s.do}): ${s.say}\n  expect: ${s.expect ?? '-'}\n  ${changes.length ? changes.join('\n  ') : '(no visible change)'}`);
    report.steps.push({ n: i + 1, page: s.page, say: s.say, expect: s.expect, changes });
  }
}
writeFileSync(path.join(cacheDir, `${c.id}-report.json`), JSON.stringify(report, null, 1));
console.log(`\ndone in ${secs()}, ${jevCalls} Jev calls. Report: ${path.join(cacheDir, `${c.id}-report.json`)}`);
