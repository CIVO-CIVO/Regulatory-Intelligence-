import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineChunks, scoreOf, selectFacts, relevanceQuestion, complianceQuestion, ruleView, chunkSections } from '../src/lib/rules.ts';
import type { Requirement } from '../src/lib/types.ts';

const rule: Requirement = {
  id: 'R1', category: 'HIPAA security', section: '§ 164.312(b)', title: 'Audit controls', need: 'Record and examine activity in systems with ePHI.',
  criticality: 'critical', quote: { docId: 'D1', text: 'Implement hardware, software, and/or procedural mechanisms that record and examine activity.', start: 0, end: 10, match: 'exact' },
  questions: [], evidence: [], topic: 'logging or monitoring access to systems holding patient data',
  complies: 'Access to the data is logged and the logs are reviewed.', conflicts: 'Logging is switched off or access is not recorded.',
};

test('graded score: forgiving weights; a clear conflict is red whatever the score', () => {
  assert.deepEqual(scoreOf({ complies: 0.2, mostly: 0.5, unclear: 0.28, conflicts: 0.02 }), { score: 79, tone: 'green', conflict: false });
  assert.equal(scoreOf({ complies: 0, mostly: 0.3, unclear: 0.5, conflicts: 0.2 }).tone, 'amber');
  const c = scoreOf({ complies: 0.3, mostly: 0.1, unclear: 0.05, conflicts: 0.55 });
  assert.equal(c.tone, 'red');
  assert.equal(c.conflict, true);
});

test('relevance gate: not relevant stays neutral; "only mentioned" below 0.9 stays neutral; failed answer is not a score', () => {
  assert.equal(combineChunks('R1', [{ relevance: 0.4, probs: { complies: 1 }, sections: [] }]).relevant, false);
  const brushed = combineChunks('R1', [{ relevance: 0.8, probs: { complies: 0.1, mostly: 0.1, unclear: 0.75, conflicts: 0.05 }, sections: [] }]);
  assert.equal(brushed.relevant, false);
  assert.equal(brushed.tone, 'grey');
  const clear = combineChunks('R1', [{ relevance: 0.95, probs: { complies: 0.1, mostly: 0.1, unclear: 0.75, conflicts: 0.05 }, sections: ['A'] }]);
  assert.equal(clear.relevant, true);
  const failed = combineChunks('R1', [{ relevance: 0.9, sections: [] }]);
  assert.equal(failed.relevant, true);
  assert.equal(failed.score, undefined);
  assert.equal(failed.tone, 'grey');
  assert.ok(failed.error);
});

test('long page: a conflict in any relevant part is shown even if another part complies', () => {
  const r = combineChunks('R1', [
    { relevance: 0.9, probs: { complies: 0.9, mostly: 0.05, unclear: 0.03, conflicts: 0.02 }, sections: ['Part 1'] },
    { relevance: 0.8, probs: { complies: 0.05, mostly: 0.05, unclear: 0.1, conflicts: 0.8 }, sections: ['Part 2'] },
  ]);
  assert.equal(r.conflict, true);
  assert.equal(r.tone, 'red');
  assert.deepEqual(r.sections, ['Part 1', 'Part 2']);
});

test('questions are self-contained: topic in relevance, verbatim rule and both criteria in compliance', () => {
  const q1 = relevanceQuestion(rule);
  assert.equal(q1.type, 'boolean');
  assert.match(String(q1.instructions.question), /logging or monitoring access/);
  const q2 = complianceQuestion(rule, () => '45 CFR 164.pdf');
  assert.deepEqual(Object.keys(q2.criteria), ['complies', 'mostly', 'unclear', 'conflicts']);
  assert.match(JSON.stringify(q2.instructions), /record and examine activity/);
  assert.match(q2.criteria.conflicts, /Logging is switched off/);
  assert.match(String((q2.instructions.rule as { source: string }).source), /§ 164\.312\(b\)/);
});

test('rules from the first engine get usable criteria from their title and summary', () => {
  const old = { ...rule, topic: undefined, complies: undefined, conflicts: undefined };
  const v = ruleView(old);
  assert.match(v.topic, /audit controls/);
  assert.match(v.complies, /Record and examine activity/);
});

test('project facts: the passages that share words with the page come first, within budget', () => {
  const para = (s: string) => `${s} `.repeat(12).trim();
  const dossier = [
    para('PMA status: the PMA was filed and is under review; it is not approved for sale.'),
    para('The cafeteria menu changes weekly and offers soup on Fridays and other days.'),
    para('IDE approval letter CX-IDE-0042 limits use of CardioX to the clinical investigation.'),
  ].join('\n\n');
  const f = selectFacts([{ id: 'F1', name: 'Dossier', text: dossier }], 'The brochure says CardioX has FDA PMA approval for sale.', 2000);
  assert.ok(f.length >= 1);
  assert.match(f[0].text, /PMA/);
  assert.ok(!f.some((x) => /cafeteria/.test(x.text)));
});

test('long pages are split into chunks under the size limit', () => {
  const sections = Array.from({ length: 30 }, (_, i) => ({ heading: `S${i}`, text: 'x'.repeat(3000), start: 0, end: 0 }));
  const chunks = chunkSections(sections, 36000);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((c) => c.reduce((n, s) => n + s.text.length + s.heading.length, 0) <= 36000));
});
