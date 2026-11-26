import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { signature } from '../src/lib/pages.ts';
import type { Project } from '../src/lib/types.ts';

// Projects published with the app (public/seed) must open ready: current engine, every page already checked
// against its current text, and every rule quote exactly as it stands in its document.
const dir = 'public/seed';
const index: { id: string; version: number; file: string; name: string }[] = existsSync(path.join(dir, 'index.json'))
  ? JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8'))
  : [];

for (const s of index) {
  test(`seed ${s.id}: ready to open`, () => {
    const p: Project = JSON.parse(readFileSync(path.join(dir, s.file), 'utf8'));
    assert.equal(p.id, s.id);
    assert.equal(p.name, s.name);
    assert.equal(p.engine, 2);
    assert.equal(p.status, 'ready');
    assert.ok(p.requirements.length > 0);
    assert.ok(Number.isInteger(s.version) && s.version >= 1);
    for (const pg of p.pages) {
      const pc = p.pageChecks?.[pg.id];
      assert.ok(pc, `page ${pg.title} has no check`);
      assert.equal(pc!.signature, signature([pg]), `page ${pg.title} check is stale`);
    }
    for (const r of p.requirements) {
      const d = p.documents.find((x) => x.id === r.quote.docId);
      assert.ok(d, `${r.id}: unknown document`);
      assert.equal(d!.text.slice(r.quote.start, r.quote.end), r.quote.text, `${r.id}: quote does not match its document`);
    }
  });
}
