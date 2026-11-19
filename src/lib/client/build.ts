'use client';
import { extractFile } from './extract';
import { postJson } from './api';
import { newId } from './store';
import { SOURCE_ROLES, type DocRole, type KbDocument, type Project, type Requirement } from '../types';

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
  { key: 'rules', label: 'Finding the requirements in your rule documents', state: 'waiting' },
  { key: 'questions', label: 'Writing Jev questions for each requirement', state: 'waiting' },
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

/** Steps 3 and 4: requirement map from the rule documents, then Jev questions per category. */
export async function buildRequirements(
  project: Pick<Project, 'name' | 'description' | 'documents'>,
  update: (key: Step['key'], patch: Partial<Step>) => void,
): Promise<Pick<Project, 'categories' | 'requirements' | 'dropped'>> {
  const sources = project.documents.filter((d) => d.role && SOURCE_ROLES.includes(d.role));
  // Only the applicant's evidence backs claims. An earlier draft is not evidence: comparing the
  // draft with itself would make persuasive wording look "supported".
  const evidence = project.documents.filter((d) => d.role === 'evidence');
  if (!sources.length) {
    throw new Error(
      'None of the files looks like a regulation, guidance or standard, so there are no rules to check against. Open the knowledge base, set the role of your rule documents, and rebuild.',
    );
  }
  update('rules', { state: 'running', detail: `${sources.length} rule document${sources.length > 1 ? 's' : ''}` });
  const map = await postJson<Pick<Project, 'categories' | 'requirements' | 'dropped'>>(
    '/api/analyze/requirements',
    {
      name: project.name,
      description: project.description,
      docs: project.documents.map((d) => ({ id: d.id, name: d.name, role: d.role, title: d.title })),
      sources: sources.map((d) => ({ id: d.id, name: d.name, text: d.text })),
    },
    { gzip: true },
  );
  if (!map.requirements.length) throw new Error('No requirements about the document content were found in the rule documents.');
  update('rules', { state: 'done', detail: `${map.requirements.length} requirements in ${map.categories.length} categories` });

  // Batches of at most 5 requirements (large categories are split): smaller, faster, sturdier calls.
  const batches: { category: string; reqs: Requirement[] }[] = [];
  for (const category of map.categories) {
    const all = map.requirements.filter((r) => r.category === category);
    for (let i = 0; i < all.length; i += 5) batches.push({ category, reqs: all.slice(i, i + 5) });
  }
  update('questions', { state: 'running', detail: `0 of ${batches.length} batches` });
  let done = 0;
  const fallbacks: string[] = [];
  const queue = [...batches];
  const evidencePayload = evidence.map((d) => ({ id: d.id, name: d.name, text: d.text }));
  const worker = async () => {
    while (queue.length) {
      const { category, reqs } = queue.shift()!;
      const payload = {
        description: project.description,
        category,
        requirements: reqs.map((r) => ({ id: r.id, title: r.title, need: r.need, criticality: r.criticality, quote: r.quote })),
        evidence: evidencePayload,
      };
      type Res = { requirements: Pick<Requirement, 'id' | 'questions' | 'evidence' | 'hint'>[] };
      let res: Res;
      try {
        res = await postJson<Res>('/api/analyze/questions', payload, { gzip: true });
      } catch (first) {
        if ((first as { code?: string }).code === 'gateway_card_required') throw first;
        try {
          res = await postJson<Res>('/api/analyze/questions', payload, { gzip: true });
        } catch {
          // Keep the build going: these requirements get one plain coverage question each.
          if (!fallbacks.includes(category)) fallbacks.push(category);
          res = {
            requirements: reqs.map((r) => ({
              id: r.id,
              questions: [{ id: `${r.id}.1`, kind: 'coverage' as const, element: `this content: ${r.need.replace(/\.$/, '')}` }],
              evidence: [],
            })),
          };
        }
      }
      for (const r of reqs) {
        const q = res.requirements.find((x) => x.id === r.id);
        if (q) Object.assign(r, { questions: q.questions, evidence: q.evidence, hint: q.hint });
      }
      done++;
      update('questions', { detail: `${done} of ${batches.length} batches` });
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, batches.length) }, worker));
  const nq = map.requirements.reduce((n, r) => n + r.questions.length, 0);
  update('questions', { state: 'done', detail: `${nq} questions${fallbacks.length ? ` (simple questions used for ${fallbacks.join(', ')})` : ''}` });
  if (fallbacks.length) {
    map.dropped = [...map.dropped, ...fallbacks.map((c) => ({ title: c, reason: 'Question writing failed twice, so each requirement here has one simple question.' }))];
  }
  return map;
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
    draft: '',
    results: {},
    engines: engines ? { llm: engines.llm, jev: engines.jev } : undefined,
  };
  const map = await buildRequirements(project, update);
  return { ...project, ...map, dropped: [...project.dropped, ...map.dropped], status: 'ready', updatedAt: Date.now() };
}
