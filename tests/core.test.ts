import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { locateQuote, pageAt, splitSections, selectSections, countWords } from '../src/lib/text.ts';
import { lintElement } from '../src/lib/lint.ts';

const cfr = readFileSync('public/examples/flexiguard-510k/21-CFR-807-subpart-E.txt', 'utf8');

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
  const draft = readFileSync('public/examples/flexiguard-510k/draft.txt', 'utf8');
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

test('linter flags unresolved references and vague qualifiers', () => {
  assert.ok(lintElement('the specified safety endpoint').length > 0);
  assert.ok(lintElement('an adequate description of the device').length > 0);
  assert.equal(lintElement('the trade name of the device').length, 0);
});

test('long draft with single line breaks: text near the end still reaches Jev', () => {
  const para = (i: number) => `Paragraph ${i} describes general background about the wound dressing programme and its history in some detail.`;
  const lines = Array.from({ length: 180 }, (_, i) => para(i));
  lines.push('The shelf life of the FlexiGuard dressing is 3 years when stored between 5 and 30 degrees.');
  const draft = `Submission\n${lines.join('\n')}`;
  assert.ok(draft.length > 19000);
  const sections = splitSections(draft);
  assert.ok(sections.length > 5, 'oversized block is split into parts');
  const picked = selectSections(sections, 'shelf life storage conditions expiry');
  assert.ok(picked.some((s) => s.text.includes('shelf life of the FlexiGuard')), 'shelf-life text is sent');
});

