// Validation harness for engine 2 against an A/B test set with an answer key.
//   tsx --conditions=react-server scripts/validate-pages.mts <dir> [--rebuild]
// <dir> holds: D*.json (rule documents {id,name,text}), dossier.md (project facts),
// tests.json ([{n, topic, variant: 'A'|'B', text}]), anchors.json ({n: "§§ ... "}).
// A paragraphs break rules and should score low / conflict; B paragraphs fix them and should score high.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { extractRules, writeCriteria, checkPage, type SourceDoc } from '../src/lib/server/pipeline.ts';
import { selectFacts } from '../src/lib/rules.ts';
import { splitDocument } from '../src/lib/text.ts';
import type { Requirement, RuleCheck } from '../src/lib/types.ts';

const dir = process.argv[2];
const rebuild = process.argv.includes('--rebuild');
const docs: SourceDoc[] = readdirSync(dir).filter((f) => /^D\d+\.json$/.test(f)).sort().map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
const dossier = readFileSync(path.join(dir, 'dossier.md'), 'utf8');
const tests: { n: number; topic: string; variant: 'A' | 'B'; text: string }[] = JSON.parse(readFileSync(path.join(dir, 'tests.json'), 'utf8'));
const anchors: Record<string, string> = JSON.parse(readFileSync(path.join(dir, 'anchors.json'), 'utf8'));
const cacheFile = path.join(dir, 'rules-cache.json');
const docName = (id: string) => docs.find((d) => d.id === id)?.name ?? id;

async function pool<T, R>(xs: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < xs.length) { const i = next++; out[i] = await fn(xs[i], i); } }));
  return out;
}

let rules: Requirement[];
if (!rebuild && existsSync(cacheFile)) {
  rules = JSON.parse(readFileSync(cacheFile, 'utf8'));
  console.log(`rules from cache: ${rules.length}`);
} else {
  const t0 = Date.now();
  const ctx = { name: 'CardioTrace compliance', description: '', otherDocs: ['CardioX regulatory dossier (project facts)'] };
  const jobs = docs.flatMap((d) => { const parts = splitDocument(d.text); return parts.map((p, i) => ({ d, p, n: i + 1, of: parts.length })); });
  const per = await pool(jobs, 4, (j) => extractRules({ ...j.d, text: j.p.text }, { ...ctx, part: { n: j.n, of: j.of, offset: j.p.offset } }));
  console.log(`  ${jobs.length} parts: ${jobs.map((j, i) => `${j.d.name.slice(0, 18)} ${j.n}/${j.of}: ${per[i].rules.length}`).join(' | ')}`);
  rules = per.flatMap((p) => p.rules);
  rules.forEach((r, i) => (r.id = `R${i + 1}`));
  console.log(`extracted ${rules.length} rules, dropped ${per.reduce((n, p) => n + p.dropped.length, 0)}, in ${Math.round((Date.now() - t0) / 1000)} s`);
  // Quote offsets must point into the full document.
  const bad = rules.filter((r) => { const d = docs.find((x) => x.id === r.quote.docId)!; return d.text.slice(r.quote.start, r.quote.end) !== r.quote.text; }).length;
  console.log(`  quotes mapped back to the full document: ${rules.length - bad}/${rules.length} exact`);
  const groups: Requirement[][] = [];
  for (let i = 0; i < rules.length; i += 6) groups.push(rules.slice(i, i + 6));
  const done = await pool(groups, 6, (g) => writeCriteria(g, { description: '' }).catch(() => g));
  rules = done.flat();
  writeFileSync(cacheFile, JSON.stringify(rules, null, 1));
  console.log(`criteria written in ${Math.round((Date.now() - t0) / 1000)} s total`);
}
const cats = [...new Set(rules.map((r) => r.category))];
console.log(`categories (${cats.length}): ${cats.join(', ')}`);

// --- anchor matching ("§§164.502, 164.512(i)", "164.400–414", "814.80–814.84")
function anchorRanges(s: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /(\d{3})\.(\d+)(?:\([a-z0-9]+\))?(?:\s*[–-]\s*(?:(\d{3})\.)?(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const part = Number(m[1]);
    const a = Number(m[2]);
    const b = m[4] ? Number(m[4]) : a;
    out.push([part * 10000 + a, part * 10000 + b]);
  }
  return out;
}
const ruleNum = (r: Requirement) => {
  const m = (r.section ?? '').match(/(\d{3})\.(\d+)/);
  return m ? Number(m[1]) * 10000 + Number(m[2]) : -1;
};
const isAnchor = (r: Requirement, n: number) => anchorRanges(anchors[n] ?? '').some(([a, b]) => ruleNum(r) >= a && ruleNum(r) <= b);

// --- run every paragraph as its own page, with the dossier as project facts
const t1 = Date.now();
let calls = 0;
const results = await pool(tests, 4, async (t) => {
  const facts = selectFacts([{ id: 'F1', name: 'CardioX regulatory dossier', text: dossier }], t.text);
  const res = await checkPage({ title: `Addendum: test ${t.n}${t.variant}`, text: t.text }, rules, facts, docName, { askFrom: 0.3 });
  calls += res.jevCalls;
  if (res.errors.length) console.log(`  ! ${t.n}${t.variant}: ${res.errors.slice(0, 2).join(' | ')}`);
  return { t, res: res.rules };
});
console.log(`checked ${tests.length} pages in ${Math.round((Date.now() - t1) / 1000)} s, ${calls} Jev calls\n`);

const fmt = (c: RuleCheck, r: Requirement) => `${r.section ?? r.id} ${c.conflict ? 'CONFLICT' : c.tone}${c.score !== undefined ? ` ${c.score}` : ''}`;
const report: unknown[] = [];
let anchorHitA = 0, anchorHitB = 0, flaggedA = 0, okB = 0, dirOk = 0, falseRedB = 0, nRel = 0;
const byN = new Map<number, { A?: (typeof results)[number]; B?: (typeof results)[number] }>();
for (const x of results) byN.set(x.t.n, { ...byN.get(x.t.n), [x.t.variant]: x });
for (const [n, pair] of [...byN.entries()].sort((a, b) => a[0] - b[0])) {
  const line: string[] = [`Test ${n} (${pair.A?.t.topic}) anchors: ${anchors[n]}`];
  const stats: Record<string, { anchored: number[]; conflictAnchored: boolean; relevant: number; red: number; anyConflict: boolean }> = {};
  for (const v of ['A', 'B'] as const) {
    const x = pair[v];
    if (!x) continue;
    const rel = rules.filter((r) => x.res[r.id]?.relevant && x.res[r.id].score !== undefined);
    const anchored = rel.filter((r) => isAnchor(r, n));
    nRel += rel.length;
    stats[v] = {
      anchored: anchored.map((r) => x.res[r.id].score!),
      conflictAnchored: anchored.some((r) => x.res[r.id].conflict),
      relevant: rel.length,
      red: rel.filter((r) => x.res[r.id].tone === 'red').length,
      anyConflict: rel.some((r) => x.res[r.id].conflict),
    };
    const shown = rel.sort((a, b) => (x.res[a.id].score ?? 0) - (x.res[b.id].score ?? 0)).slice(0, 8);
    line.push(`  ${v}: ${rel.length} relevant, ${anchored.length} on anchor sections | ${shown.map((r) => `${isAnchor(r, n) ? '*' : ''}${fmt(x.res[r.id], r)}`).join(', ')}`);
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const A = stats.A, B = stats.B;
  if (A?.anchored.length) anchorHitA++;
  if (B?.anchored.length) anchorHitB++;
  const aFlag = A && (A.conflictAnchored || A.anyConflict || Math.min(...(A.anchored.length ? A.anchored : [100])) < 45);
  const bOk = B && B.anchored.length > 0 && !B.conflictAnchored && mean(B.anchored) >= 60;
  if (aFlag) flaggedA++;
  if (bOk) okB++;
  if (A && B && mean(B.anchored) > mean(A.anchored)) dirOk++;
  if (B) falseRedB += B.red;
  line.push(`  => A flagged: ${aFlag ? 'yes' : 'NO'} | B ok: ${bOk ? 'yes' : 'NO'} | anchor mean A ${mean(A?.anchored ?? []).toFixed(0)} -> B ${mean(B?.anchored ?? []).toFixed(0)}`);
  console.log(line.join('\n'));
  report.push({ n, A, B });
}
const N = byN.size;
console.log(`\nSUMMARY over ${N} tests
  anchor section found relevant: A ${anchorHitA}/${N}, B ${anchorHitB}/${N}
  A (breaks rules) flagged red/conflict: ${flaggedA}/${N}
  B (fixed) ok on anchors (no conflict, mean >= 60): ${okB}/${N}
  direction A -> B up on anchors: ${dirOk}/${N}
  red rules on B pages (false alarms): ${falseRedB}
  relevant rules per page: ${(nRel / tests.length).toFixed(1)} of ${rules.length}`);
writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 1));
// Raw answers for offline tuning of thresholds and weights.
writeFileSync(path.join(dir, 'raw.json'), JSON.stringify(results.map((x) => ({
  n: x.t.n, v: x.t.variant,
  rules: Object.values(x.res).filter((c) => c.relevance >= 0.3).map((c) => {
    const r = rules.find((y) => y.id === c.reqId)!;
    return { id: c.reqId, section: r.section, anchor: isAnchor(r, x.t.n), relevance: c.relevance, probs: c.probs, score: c.score };
  }),
})), null, 0));
