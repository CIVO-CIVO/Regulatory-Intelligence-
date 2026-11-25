import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateProject, pageSections, signature, totalWords, nextPageId } from '../src/lib/pages.ts';
import type { Project } from '../src/lib/types.ts';

const legacy = {
  id: 'x', name: 'n', description: '', createdAt: 0, updatedAt: 0, status: 'ready', documents: [], categories: [], requirements: [],
  dropped: [], results: {}, draft: 'Intended use\nWound care.', checkedDraft: 'Intended use\nWound care.',
} as unknown as Project;

test('a project saved before pages becomes one "Submission draft" page, check state kept', () => {
  const p = migrateProject(legacy);
  assert.equal(p.pages.length, 1);
  assert.equal(p.pages[0].title, 'Submission draft');
  assert.equal(p.pages[0].text, 'Intended use\nWound care.');
  assert.equal(p.activePageId, 'P1');
  assert.equal(signature(p.pages), signature(p.checkedPages)); // not re-checked needlessly
  assert.equal(p.draft, undefined);
  assert.equal(migrateProject(p), p); // idempotent
});

test('one page keeps its own headings; several pages prefix the page title; empty pages skipped', () => {
  const one = pageSections([{ title: 'Submission draft', text: 'Labeling\nWarnings are listed.' }]);
  assert.deepEqual(one.map((s) => s.heading), ['Labeling']);
  const many = pageSections([
    { title: 'Device', text: 'Description\nA foam dressing.' },
    { title: 'Empty', text: '   ' },
    { title: 'Labeling', text: 'Warnings\nDo not use on burns.' },
  ]);
  assert.deepEqual(many.map((s) => s.heading), ['Device › Description', 'Labeling › Warnings']);
  assert.equal(totalWords([{ title: 'a', text: 'one two' }, { title: 'b', text: 'three' }]), 3);
  assert.equal(nextPageId([{ id: 'P1', title: '', text: '' }, { id: 'P4', title: '', text: '' }]), 'P5');
});

test('Word-style text (blank line after every paragraph) keeps real sections together', async () => {
  const { readFileSync } = await import('node:fs');
  const labeling = readFileSync('public/examples/flexiguard-510k/Labeling-draft.txt', 'utf8').replace(/\n/g, '\n\n');
  const secs = pageSections([{ title: 'Labeling', text: labeling }]);
  const heads = secs.map((s) => s.heading);
  assert.ok(heads.includes('6. WARNINGS'), 'numbered heading kept');
  assert.ok(heads.length < 30, `few sections, got ${heads.length}`);
  assert.ok(!heads.some((h) => /^(Norway|Untitled)/.test(h)), 'short body lines are not headings');
  const warn = secs.find((s) => s.heading === '6. WARNINGS')!;
  assert.ok(warn.text.length > 100, 'warning paragraphs stay in their section');
});
