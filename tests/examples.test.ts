import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Every example project listed in public/examples/index.json must load in the app and its demo script must
// apply cleanly, step by step, to the draft pages (each "find" exactly once at that point).
const root = 'public/examples';
const index: { id: string; menu: string; menuSub: string }[] = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8'));
const ACCEPT = /\.(pdf|docx|xlsx|csv|txt|md|text|json|xml|html|htm)$/i;
const DASHES = /[–—]/;

test('index lists at least one example and every id has a case.json', () => {
  assert.ok(index.length >= 1);
  assert.equal(new Set(index.map((x) => x.id)).size, index.length);
  for (const x of index) assert.ok(existsSync(path.join(root, x.id, 'case.json')), x.id);
});

for (const x of index) {
  test(`example ${x.id}: files, pages and demo script`, () => {
    const dir = path.join(root, x.id);
    const c = JSON.parse(readFileSync(path.join(dir, 'case.json'), 'utf8'));
    assert.equal(c.id, x.id);
    for (const k of ['name', 'description', 'notice']) assert.ok(String(c[k] ?? '').trim(), `${x.id}: ${k}`);
    assert.ok(c.files.length >= 2, 'at least two files');
    for (const f of c.files) {
      assert.ok(existsSync(path.join(dir, f.path)), `${x.id}: missing ${f.path}`);
      assert.match(f.label, ACCEPT, `${x.id}: label needs a supported extension: ${f.label}`);
    }
    assert.ok(c.pages.length >= 1);
    const pages = new Map<string, string>(c.pages.map((p: { title: string; path: string }) => [p.title, readFileSync(path.join(dir, p.path), 'utf8').trim()]));
    for (const [title, text] of pages) assert.ok(!DASHES.test(text), `${x.id}: long dash on page ${title}`);
    assert.ok(!DASHES.test(JSON.stringify(c)), `${x.id}: long dash in case.json`);
    for (const [i, s] of (c.demo ?? []).entries()) {
      const text = pages.get(s.page);
      assert.ok(text !== undefined, `${x.id} step ${i + 1}: no page ${s.page}`);
      if (s.do !== 'append') assert.equal(text!.split(s.find).length - 1, 1, `${x.id} step ${i + 1}: find must occur once`);
      const next =
        s.do === 'replace' ? text!.replace(s.find, s.text ?? '')
        : s.do === 'delete' ? text!.replace(s.find, '').replace(/\n{3,}/g, '\n\n').trim()
        : s.do === 'insert-after' ? text!.replace(s.find, `${s.find}${s.text}`)
        : `${text}\n\n${s.text}`.trim();
      pages.set(s.page, next);
    }
  });
}
