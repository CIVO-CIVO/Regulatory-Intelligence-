// Build a ready-to-demo project snapshot for public/seed/: the owner's own project (exported from the browser),
// rebuilt with the current engine and with every page already checked, so it opens instantly on any device.
// The app adds the snapshots listed in public/seed/index.json to each browser once (src/lib/client/store.ts).
//
//   set -a; . ~/.config/regulatory-intelligence/secrets.env; set +a
//   ./node_modules/.bin/tsx --conditions=react-server scripts/build-seed.mts <config.json> [--rebuild]
//
// config.json:
//   { "export": "<IndexedDB export: { all: { projects: { 'p:<id>': Project } } }>", "key": "p:<id>",
//     "seedId": "<short id>", "version": 1, "addFacts": [{ "path": "...", "name": "..." }], "activePageId": "P1",
//     "demo": [ optional demo steps, same format as case.json; run after the build and printed, not saved ] }
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { checkPage } from '../src/lib/server/pipeline.ts';
import { selectFacts } from '../src/lib/rules.ts';
import { countWords, hash } from '../src/lib/text.ts';
import { migrateProject, signature } from '../src/lib/pages.ts';
import type { DroppedRequirement, KbDocument, PageCheck, Project, Requirement, RuleCheck } from '../src/lib/types.ts';
import { buildRules, classifyDocs, readDoc } from './lib/engine.mts';

interface Config {
  export: string;
  key: string;
  seedId: string;
  version: number;
  addFacts?: { path: string; name: string }[];
  activePageId?: string;
  demo?: { page: string; do: 'replace' | 'delete' | 'append' | 'insert-after'; find?: string; text?: string; say: string; expect?: string }[];
}

const cfg: Config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rebuild = process.argv.includes('--rebuild');
const cacheDir = process.env.DEMO_CACHE || path.join(os.tmpdir(), 'ri-demo-cache');
mkdirSync(cacheDir, { recursive: true });
const t0 = Date.now();
const secs = () => `${Math.round((Date.now() - t0) / 1000)} s`;

const original = migrateProject(JSON.parse(readFileSync(cfg.export, 'utf8')).all.projects[cfg.key] as Project);
const p: Project = structuredClone(original);
console.log(`# ${p.name}: ${p.documents.length} documents, ${p.pages.length} pages, engine ${p.engine ?? 1}`);

// New project-fact files are read like an upload and sorted like "+ Files" in the knowledge base.
let maxId = Math.max(0, ...p.documents.map((d) => Number(d.id.slice(1)) || 0));
const added: KbDocument[] = [];
for (const f of cfg.addFacts ?? []) {
  const r = await readDoc(f.path);
  added.push({ id: `D${++maxId}`, name: f.name, size: r.text.length, kind: 'text', text: r.text, quality: { chars: r.text.length, lowTextPages: [] } });
}
if (added.length) {
  const info = await classifyDocs(p.description, added);
  for (const d of added) {
    d.role = 'evidence'; // added as project facts on purpose
    d.title = info[d.id]?.title;
    d.summary = info[d.id]?.summary;
    console.log(`  + ${d.id} ${d.name} (${d.text.length} chars) as project facts; sorter said ${info[d.id]?.role}`);
  }
  p.documents.push(...added);
}
for (const d of p.documents) console.log(`  ${d.id} ${String(d.role).padEnd(10)} ${String(d.text.length).padStart(7)}  ${d.name}`);

// Rules: the same build as "Rebuild checklist" in the app, cached by document content.
const key = hash(JSON.stringify([p.name, p.description, p.documents.map((d) => [d.name, d.role, d.text])]));
const cacheFile = path.join(cacheDir, `seed-${cfg.seedId}-${key}.json`);
let built: { rules: Requirement[]; categories: string[]; dropped: DroppedRequirement[] };
if (!rebuild && existsSync(cacheFile)) {
  built = JSON.parse(readFileSync(cacheFile, 'utf8'));
  console.log(`rules from cache: ${built.rules.length}`);
} else {
  built = await buildRules(p.documents.map((d) => ({ id: d.id, name: d.name, kind: d.kind, text: d.text, role: d.role })), { name: p.name, description: p.description }, (s) => console.log(`${s} (${secs()})`));
  writeFileSync(cacheFile, JSON.stringify(built));
}
const { rules, categories } = built;
console.log(`groups: ${categories.map((g) => `${g} (${rules.filter((r) => r.category === g).length})`).join(' | ')}`);

// Check every page, as the app does when a page is opened.
const evidence = p.documents.filter((d) => d.role === 'evidence').map((d) => ({ id: d.id, name: d.name, text: d.text }));
const docName = (id: string) => p.documents.find((d) => d.id === id)?.name ?? id;
const byId = new Map(rules.map((r) => [r.id, r]));
async function check(title: string, text: string) {
  const facts = selectFacts(evidence, text);
  const res = await checkPage({ title, text }, rules.filter((r) => !r.muted), facts.slice(0, 20), docName);
  if (res.errors.length) console.log(`  !! Jev errors on "${title}": ${res.errors.slice(0, 2).join(' | ')}`);
  return { res, facts };
}
const tag = (x?: RuleCheck) => (!x || !x.relevant ? 'neutral' : x.error ? 'not checked' : `${x.conflict ? 'RED!' : x.tone.toUpperCase()} ${x.score ?? ''}`.trim());
const pageChecks: Record<string, PageCheck> = {};
for (const pg of p.pages) {
  if (countWords(pg.text) < 3) {
    pageChecks[pg.id] = { signature: signature([pg]), title: pg.title, text: pg.text, at: Date.now(), rules: {}, facts: [] };
    continue;
  }
  const { res, facts } = await check(pg.title, pg.text);
  pageChecks[pg.id] = { signature: signature([pg]), title: pg.title, text: pg.text, at: Date.now(), rules: res.rules, facts, model: res.model, partial: res.partial || undefined };
  const rel = Object.values(res.rules).filter((x) => x.relevant);
  const n = (t: string) => rel.filter((x) => x.tone === t).length;
  console.log(`\n== ${pg.id} "${pg.title}" (${countWords(pg.text)} words): ${rel.length} relevant: ${n('green')} green, ${n('amber')} amber, ${n('red')} red${res.partial ? ' (PARTIAL)' : ''}`);
  for (const x of rel.filter((y) => y.tone === 'red')) console.log(`  ${tag(x).padEnd(9)} ${byId.get(x.reqId)!.section ?? ''} ${byId.get(x.reqId)!.title}`);
}

const earlierUnread = p.dropped.filter((d) => d.reason === 'File could not be read.');
const now = Date.now();
const seed: Project = {
  ...p,
  engine: 2,
  status: 'ready',
  requirements: rules,
  categories,
  baseRequirements: rules,
  baseCategories: categories,
  focus: undefined,
  dropped: [...earlierUnread, ...built.dropped],
  results: {},
  pageChecks,
  checkedPages: undefined,
  activePageId: cfg.activePageId ?? p.activePageId,
  updatedAt: now,
};
const outDir = 'public/seed';
mkdirSync(outDir, { recursive: true });
const file = `${cfg.seedId}.json`;
writeFileSync(path.join(outDir, file), JSON.stringify(seed));
const idxFile = path.join(outDir, 'index.json');
const idx: { id: string; version: number; file: string; name: string; replaceIfNotNewerThan?: number }[] = existsSync(idxFile) ? JSON.parse(readFileSync(idxFile, 'utf8')) : [];
const entry = { id: p.id, version: cfg.version, file, name: p.name, replaceIfNotNewerThan: original.updatedAt };
writeFileSync(idxFile, `${JSON.stringify([...idx.filter((x) => x.id !== p.id), entry], null, 2)}\n`);
console.log(`\nwrote ${path.join(outDir, file)} (${Math.round(JSON.stringify(seed).length / 1024)} KB) and ${idxFile} in ${secs()}`);

// Optional demo steps: applied to copies of the pages, printed, never saved.
if (cfg.demo?.length) {
  console.log('\n---------------- demo steps');
  const texts = new Map(p.pages.map((pg) => [pg.title, pg.text]));
  const last = new Map(p.pages.map((pg) => [pg.title, pageChecks[pg.id].rules]));
  for (const [i, s] of cfg.demo.entries()) {
    const before = texts.get(s.page);
    if (before === undefined) throw new Error(`step ${i + 1}: no page "${s.page}"`);
    const count = s.find ? before.split(s.find).length - 1 : 0;
    if (s.do !== 'append' && count !== 1) throw new Error(`step ${i + 1}: "find" occurs ${count} times on "${s.page}"`);
    const after =
      s.do === 'replace' ? before.replace(s.find!, s.text ?? '')
      : s.do === 'delete' ? before.replace(s.find!, '').replace(/\n{3,}/g, '\n\n').trim()
      : s.do === 'insert-after' ? before.replace(s.find!, `${s.find}${s.text}`)
      : `${before}\n\n${s.text}`.trim();
    texts.set(s.page, after);
    const prev = last.get(s.page)!;
    const next = (await check(s.page, after)).res.rules;
    last.set(s.page, next);
    const changes = rules
      .filter((r) => tag(prev[r.id]) !== tag(next[r.id]))
      .filter((r) => (prev[r.id]?.relevant ?? false) !== (next[r.id]?.relevant ?? false) || prev[r.id]?.tone !== next[r.id]?.tone || !!prev[r.id]?.conflict !== !!next[r.id]?.conflict || Math.abs((prev[r.id]?.score ?? 0) - (next[r.id]?.score ?? 0)) >= 10)
      .map((r) => `${r.id} ${r.section ?? ''} ${r.title}: ${tag(prev[r.id])} -> ${tag(next[r.id])}`);
    console.log(`\nStep ${i + 1} (${s.page}, ${s.do}): ${s.say}\n  expect: ${s.expect ?? '-'}\n  ${changes.length ? changes.join('\n  ') : '(no visible change)'}`);
  }
}
