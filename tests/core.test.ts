import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { locateQuote, pageAt, splitSections, selectSections, countWords } from '../src/lib/text.ts';
import { buildJobs, scoreRequirement, toQuestionResult } from '../src/lib/jev.ts';
import { lintElement } from '../src/lib/lint.ts';
import type { Requirement } from '../src/lib/types.ts';

const cfr = readFileSync('public/examples/21-CFR-807-subpart-E.txt', 'utf8');

test('exact quote is found and maps back to original offsets', () => {
  const q = 'The device name, including both the trade or proprietary name and the common or usual name or classification name of the device.';
  const hit = locateQuote(cfr, q);
  assert.ok(hit, 'quote should be found');
  assert.equal(hit!.match, 'exact');
  assert.equal(cfr.slice(hit!.start, hit!.end).replace(/\s+/g, ' '), hit!.text.replace(/\s+/g, ' '));
});

test('quote with different whitespace, curly quotes and case still matches exactly', () => {
  const q = 'the DEVICE name,   including both the trade or proprietary name\nand the common or usual name';
  assert.equal(locateQuote(cfr, q)?.match, 'exact');
});

test('quote with a few changed words matches fuzzily; invented text is rejected', () => {
  const original = 'The device name, including both the trade or proprietary name and the common or usual name or classification name of the device.';
  const tweaked = original.replace('proprietary', 'brand').replace('usual', 'normal');
  assert.equal(locateQuote(cfr, tweaked)?.match, 'fuzzy');
  assert.equal(locateQuote(cfr, 'Each submission shall include a certificate signed by the mayor of the applicant town confirming residence.'), null);
});

test('hyphenation across a line break is ignored', () => {
  const doc = 'The dressing absorbs exu-\n  date while keeping the wound moist at all times during use.';
  assert.equal(locateQuote(doc, 'absorbs exudate while keeping the wound moist')?.match, 'exact');
});

test('page markers give the page of a quote', () => {
  const doc = '[Page 1]\nIntro text here.\n\n[Page 2]\nThe sterility assurance level shall be stated in the submission.';
  const hit = locateQuote(doc, 'The sterility assurance level shall be stated in the submission.');
  assert.equal(pageAt(doc, hit!.start), 2);
});

test('draft sections: heading line + body, blank lines between', () => {
  const draft = readFileSync('public/examples/draft.txt', 'utf8');
  const s = splitSections(draft);
  assert.deepEqual(s.map((x) => x.heading), ['Device description', 'Intended use', 'Clinical evidence', 'Biocompatibility', 'Labeling', 'Substantial equivalence']);
  assert.match(s[2].text, /148 subjects/);
  assert.equal(countWords(draft) > 90 && countWords(draft) < 110, true);
});

test('heading alone in its block heads the next block', () => {
  const s = splitSections('Sterility\n\nThe device is supplied sterile by ethylene oxide.');
  assert.equal(s.length, 1);
  assert.equal(s[0].heading, 'Sterility');
});

test('long drafts are cut to the most relevant sections', () => {
  const filler = Array.from({ length: 40 }, (_, i) => ({ heading: `Section ${i}`, text: 'Lorem ipsum dolor sit amet '.repeat(30), start: 0, end: 0 }));
  filler.splice(17, 0, { heading: 'Sterilization', text: 'Ethylene oxide sterilization validated to a sterility assurance level of 10^-6.', start: 0, end: 0 });
  const picked = selectSections(filler, 'sterilization method sterility assurance level', 3000);
  assert.ok(picked.some((p) => p.heading === 'Sterilization'));
  assert.ok(picked.reduce((n, p) => n + p.text.length, 0) <= 3000);
});

const req: Requirement = {
  id: 'R1', category: 'Clinical', title: 'Adverse events', need: 'State device-related adverse events.', criticality: 'critical',
  quote: { docId: 'D1', text: 'The clinical evaluation shall report device-related adverse events.', start: 0, end: 10, match: 'exact' },
  questions: [
    { id: 'R1.1', kind: 'coverage', element: 'the number of device-related adverse events' },
    { id: 'R1.2', kind: 'claim', element: 'the number of device-related adverse events and subjects' },
  ],
  evidence: [{ docId: 'D2', text: 'Two device-related adverse events occurred among 148 subjects.', start: 0, end: 10, match: 'exact' }],
};

test('jobs: draft-only state for coverage, draft-vs-evidence for claims; requirement quoted verbatim', () => {
  const jobs = buildJobs(req, splitSections('Clinical evidence\nA study with 148 subjects reported 2 device-related adverse events.'), (id) => (id === 'D1' ? 'Rules.pdf' : 'CSR.pdf'));
  assert.equal(jobs.length, 2);
  assert.deepEqual(Object.keys(jobs[0].state), ['DRAFT']);
  assert.deepEqual(Object.keys(jobs[1].state).sort(), ['DRAFT', 'EVIDENCE']);
  const q = jobs[0].questions['R1.1'] as unknown as { type: string; instructions: { requirement: { text: string } } };
  assert.equal(q.type, 'boolean');
  assert.equal(q.instructions.requirement.text, req.quote.text);
  assert.equal(jobs[1].questions['R1.2'].type, 'choice');
});

test('scoring: weakest question sets the score; contradiction forces red', () => {
  const a = toQuestionResult(req.questions[0], { type: 'boolean', probability: 0.95 });
  const b = toQuestionResult(req.questions[1], { type: 'choice', choice: 'supported', probabilities: { supported: 0.6, partially_supported: 0.2, not_addressed: 0.1, contradicted: 0.05, insufficient_information: 0.05 } });
  const r = scoreRequirement(req, [a, b]);
  assert.equal(r.score, 60);
  assert.equal(r.passed, 1);
  assert.equal(r.tone, 'amber');
  const c = toQuestionResult(req.questions[1], { type: 'choice', choice: 'contradicted', probabilities: { supported: 0.5, partially_supported: 0.1, not_addressed: 0, contradicted: 0.4, insufficient_information: 0 } });
  assert.equal(scoreRequirement(req, [a, c]).tone, 'red');
  const g = scoreRequirement(req, [a, toQuestionResult(req.questions[0], { type: 'boolean', probability: 0.85 })]);
  assert.equal(g.tone, 'green');
  assert.equal(toQuestionResult(req.questions[0], { type: 'refusal' }).refused, true);
});

test('linter flags unresolved references and vague qualifiers', () => {
  assert.ok(lintElement('the specified safety endpoint').length > 0);
  assert.ok(lintElement('an adequate description of the device').length > 0);
  assert.equal(lintElement('the trade name of the device').length, 0);
});
