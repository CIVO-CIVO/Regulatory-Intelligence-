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
import { checkPage } from '../src/lib/server/pipeline.ts';
import { selectFacts } from '../src/lib/rules.ts';
import { countWords, hash } from '../src/lib/text.ts';
import type { DocRole, Requirement, RuleCheck } from '../src/lib/types.ts';
import { buildRules, classifyDocs, readDoc } from './lib/engine.mts';

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
  roles = Object.fromEntries(Object.entries(await classifyDocs(c.description, docs)).map(([id, x]) => [id, x.role]));
  console.log(`sorted (${secs()}): ${docs.map((d) => `${d.id}=${roles[d.id]}`).join(' ')}`);
  ({ rules, dropped } = await buildRules(docs.map((d) => ({ ...d, role: roles[d.id] })), { name: c.name, description: c.description }, (s) => console.log(`${s} (${secs()})`)));
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
