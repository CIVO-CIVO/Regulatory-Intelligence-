import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFocus, type FocusPlan } from '../src/lib/focus.ts';
import type { Requirement } from '../src/lib/types.ts';

const mk = (id: string, category: string, criticality: Requirement['criticality']): Requirement => ({
  id, category, title: `T${id}`, need: 'n', criticality,
  quote: { docId: 'D1', text: 'quote text long enough', start: 0, end: 5, match: 'exact' },
  questions: [{ id: `${id}.1`, kind: 'coverage', element: `element of ${id}` }],
  evidence: [],
});
const base = [mk('R1', 'Admin', 'minor'), mk('R2', 'Admin', 'major'), mk('R3', 'Clinical', 'major'), mk('R4', 'Clinical', 'minor')];
const cats = ['Admin', 'Clinical'];

test('focus: mute, priority, sharpen, add question, rank, category order; base untouched', () => {
  const plan: FocusPlan = {
    summary: 's', notes: ['Not in your documents: MDR.'], categoryOrder: ['Clinical', 'Nope'],
    requirements: [
      { id: 'R1', priority: 'unchanged', muted: true, rank: 0, sharpen: [], addQuestions: [], reason: 'admin later' },
      { id: 'R4', priority: 'critical', muted: false, rank: 1, sharpen: [{ questionId: 'R4.1', trueWhen: 'Names all five endpoints.', falseWhen: '' }],
        addQuestions: [{ element: 'the follow-up duration of the pivotal study', trueWhen: '', falseWhen: '' }], reason: 'clinical first' },
      { id: 'R99', priority: 'critical', muted: true, rank: 1, sharpen: [], addQuestions: [], reason: 'unknown id ignored' },
    ],
  };
  const out = applyFocus(base, cats, plan);
  assert.deepEqual(out.categories, ['Clinical', 'Admin']);
  assert.deepEqual(out.requirements.map((r) => r.id), ['R4', 'R3', 'R2', 'R1']);
  const r4 = out.requirements.find((r) => r.id === 'R4')!;
  assert.equal(r4.criticality, 'critical');
  assert.equal(r4.questions[0].trueWhen, 'Names all five endpoints.');
  assert.equal(r4.questions.length, 2);
  assert.equal(r4.questions[1].id, 'R4.f1');
  assert.equal(out.requirements.find((r) => r.id === 'R1')!.muted, true);
  // original checklist is never modified
  assert.equal(base[3].criticality, 'minor');
  assert.equal(base[3].questions.length, 1);
  assert.equal(base[0].muted, undefined);
  assert.ok(out.changes.some((c) => c.reqId === 'R4' && /critical/.test(c.what)));
});

test('focus: re-applying starts from the base, so changes never pile up', () => {
  const p1: FocusPlan = { summary: '', notes: [], categoryOrder: [], requirements: [{ id: 'R2', priority: 'unchanged', muted: true, rank: 0, sharpen: [], addQuestions: [], reason: '' }] };
  const p2: FocusPlan = { summary: '', notes: [], categoryOrder: [], requirements: [] };
  applyFocus(base, cats, p1);
  const out = applyFocus(base, cats, p2);
  assert.equal(out.requirements.find((r) => r.id === 'R2')!.muted, undefined);
});
