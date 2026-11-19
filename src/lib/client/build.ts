'use client';
import { extractFile } from './extract';
import { postJson } from './api';
import { newId } from './store';
import { SOURCE_ROLES, type DocRole, type KbDocument, type Project, type Requirement } from '../types';
import { splitDocument } from '../text';

export type StepState = 'waiting' | 'running' | 'done' | 'error';
export interface Step {
  key: 'read' | 'sort' | 'rules' | 'questions';
  label: string;
  state: StepState;
  detail?: string;
}

export const initialSteps = (): Step[] => [
  { key: 'read', label: 'Reading your files', state: 'waiting' },
  { key: 'sort', label: 'Sorting rules from evidence', state: 'waiting' },
  { key: 'rules', label: 'Finding the rules in each rule document', state: 'waiting' },
  { key: 'questions', label: 'Writing how Jev judges each rule', state: 'waiting' },
];

type Progress = (steps: Step[]) => void;

function stepper(onProgress: Progress) {
  const steps = initialSteps();
  const update = (key: Step['key'], patch: Partial<Step>) => {
    const i = steps.findIndex((s) => s.key === key);
    steps[i] = { ...steps[i], ...patch };
    onProgress(steps.map((s) => ({ ...s })));
  };
  return { steps, update };
}

export async function readFiles(files: File[], onEach?: (done: number) => void, startAt = 1): Promise<{ docs: KbDocument[]; failed: string[] }> {
  const docs: KbDocument[] = [];
  const failed: string[] = [];
  let i = 0;
  for (const f of files) {
    try {
      docs.push(await extractFile(f, `D${startAt + docs.length}`));
    } catch (err) {
      failed.push(`${f.name}: ${(err as Error).message}`);
    }
    onEach?.(++i);
  }
  return { docs, failed };
}

export async function classify(description: string, docs: KbDocument[]): Promise<void> {
  const res = await postJson<{ documents: { id: string; role: DocRole; title: string; summary: string }[] }>('/api/analyze/classify', {
    description,
    docs: docs.map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      chars: d.text.length,
      head: d.text.slice(0, 5000),
      tail: d.text.length > 7000 ? d.text.slice(-1200) : '',
    })),
  });
  for (const d of docs) {
    const c = res.documents.find((x) => x.id === d.id);
    d.role = c?.role ?? 'other';
    d.title = c?.title;
    d.summary = c?.summary;
  }
}

/**
 * Engine 2. Steps 3 and 4: the rules of every rule document (one call per document, in parallel, so
 * no regulation is crowded out), folded into a few readable groups; then Jev's judging criteria.
 */
export async function buildRequirements(
  project: Pick<Project, 'name' | 'description' | 'documents'>,
  update: (key: Step['key'], patch: Partial<Step>) => void,
): Promise<Pick<Project, 'categories' | 'requirements' | 'dropped' | 'engine'>> {
  const sources = project.documents.filter((d) => d.role && SOURCE_ROLES.includes(d.role));
  if (!sources.length) {
    throw new Error(
      'None of the files looks like a regulation, guidance or standard, so there are no rules to check against. Open the knowledge base, set the role of your rule documents, and rebuild.',
    );
  }
  const otherDocs = project.documents.filter((d) => !sources.includes(d)).map((d) => `${d.name} (${d.role})`);
  // Very long documents are split into parts, each read by its own call (parallel, inside time limits).
  const jobs = sources.flatMap((d, di) => {
    const parts = splitDocument(d.text);
    return parts.map((p, pi) => ({ d, di, p, n: pi + 1, of: parts.length }));
  });
  update('rules', { state: 'running', detail: `0 of ${jobs.length} parts read` });
  let docsDone = 0;
  const dropped: Project['dropped'] = [];
  const perDoc: Requirement[][] = new Array(jobs.length);
  const queue = jobs.map((j, i) => ({ ...j, i }));
  const docWorker = async () => {
    while (queue.length) {
      const { d, p, n, of, i } = queue.shift()!;
      const res = await postJson<{ rules: Requirement[]; dropped: Project['dropped'] }>(
        '/api/analyze/rules',
        { name: project.name, description: project.description, doc: { id: d.id, name: d.name, text: p.text }, otherDocs, part: { n, of, offset: p.offset } },
        { gzip: true },
      );
      perDoc[i] = res.rules;
      dropped.push(...res.dropped);
      docsDone++;
      update('rules', { detail: `${docsDone} of ${jobs.length} parts read` });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, docWorker));
  let rules = perDoc.flat();
  if (!rules.length) throw new Error('No rules were found in the rule documents.');

  const counts: Record<string, number> = {};
  for (const r of rules) counts[r.category] = (counts[r.category] ?? 0) + 1;
  let categories = Object.keys(counts);
  try {
    const g = await postJson<{ order: string[]; map: Record<string, string> }>('/api/analyze/groups', { counts });
    rules = rules.map((r) => ({ ...r, category: g.map[r.category] ?? r.category }));
    categories = g.order.filter((c) => rules.some((r) => r.category === c));
  } catch {
    // Grouping is cosmetic: keep the fine categories if it fails.
  }
  rules = categories.flatMap((c) => rules.filter((r) => r.category === c));
  rules.forEach((r, i) => (r.id = `R${i + 1}`));
  update('rules', { state: 'done', detail: `${rules.length} rules in ${categories.length} groups, from ${sources.length} document${sources.length > 1 ? 's' : ''}` });

  const batches: Requirement[][] = [];
  for (let i = 0; i < rules.length; i += 6) batches.push(rules.slice(i, i + 6));
  update('questions', { state: 'running', detail: `0 of ${batches.length} batches` });
  let done = 0;
  let failed = 0;
  const bq = [...batches];
  const worker = async () => {
    while (bq.length) {
      const b = bq.shift()!;
      type Res = { rules: Pick<Requirement, 'id' | 'topic' | 'complies' | 'conflicts' | 'hint'>[] };
      let res: Res | null = null;
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        try {
          res = await postJson<Res>('/api/analyze/criteria', { description: project.description, rules: b }, { gzip: true });
        } catch (err) {
          if ((err as { code?: string }).code === 'gateway_card_required') throw err;
        }
      }
      if (res) {
        for (const c of res.rules) {
          const r = rules.find((x) => x.id === c.id);
          if (r) Object.assign(r, { topic: c.topic, complies: c.complies, conflicts: c.conflicts, hint: c.hint });
        }
      } else failed += b.length; // these rules use criteria derived from their title and summary
      done++;
      update('questions', { detail: `${done} of ${batches.length} batches` });
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, batches.length) }, worker));
  update('questions', { state: 'done', detail: `${rules.length} rules ready${failed ? ` (${failed} with simpler criteria)` : ''}` });
  return { categories, requirements: rules, dropped, engine: 2 };
}

export async function createProject(
  input: { name: string; description: string; files: File[] },
  onProgress: Progress,
): Promise<Project> {
  const { update } = stepper(onProgress);
  const engines = await fetch('/api/status').then((r) => r.json()).catch(() => null);

  update('read', { state: 'running', detail: `0 of ${input.files.length}` });
  const { docs, failed } = await readFiles(input.files, (n) => update('read', { detail: `${n} of ${input.files.length}` }));
  if (!docs.length) throw new Error(failed.join('\n') || 'No readable files.');
  const unreadable = docs.filter((d) => d.quality.lowTextPages.length && d.quality.lowTextPages.length === d.quality.pages);
  update('read', {
    state: 'done',
    detail: `${docs.length} file${docs.length > 1 ? 's' : ''}${failed.length ? `, ${failed.length} skipped` : ''}${unreadable.length ? `, ${unreadable.length} without a text layer` : ''}`,
  });

  update('sort', { state: 'running' });
  await classify(input.description, docs);
  const nSources = docs.filter((d) => d.role && SOURCE_ROLES.includes(d.role)).length;
  update('sort', { state: 'done', detail: `${nSources} rule document${nSources === 1 ? '' : 's'}, ${docs.length - nSources} evidence and other` });

  const project: Project = {
    id: newId(),
    name: input.name.trim() || 'Untitled project',
    description: input.description.trim(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'building',
    documents: docs,
    categories: [],
    requirements: [],
    dropped: failed.map((f) => ({ title: f, reason: 'File could not be read.' })),
    pages: [{ id: 'P1', title: 'Submission draft', text: '' }],
    activePageId: 'P1',
    results: {},
    engines: engines ? { llm: engines.llm, jev: engines.jev } : undefined,
  };
  const map = await buildRequirements(project, update);
  return {
    ...project,
    ...map,
    baseRequirements: map.requirements,
    baseCategories: map.categories,
    dropped: [...project.dropped, ...map.dropped],
    status: 'ready',
    updatedAt: Date.now(),
  };
}
