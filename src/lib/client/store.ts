'use client';
// Projects live only in this browser (IndexedDB). Nothing is stored on the server.
import { createStore, del, get, set } from 'idb-keyval';
import type { Project, ProjectSummary } from '../types';
import { migrateProject } from '../pages';

const store = typeof indexedDB !== 'undefined' ? createStore('regulatory-intelligence', 'projects') : undefined;
const INDEX = 'index';

export async function listProjects(): Promise<ProjectSummary[]> {
  if (!store) return [];
  return ((await get<ProjectSummary[]>(INDEX, store)) ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<Project | undefined> {
  if (!store) return undefined;
  const p = await get<Project>(`p:${id}`, store);
  return p ? migrateProject(p) : undefined;
}

export async function saveProject(p: Project): Promise<void> {
  if (!store) return;
  await set(`p:${p.id}`, p, store);
  const idx = (await get<ProjectSummary[]>(INDEX, store)) ?? [];
  const summary: ProjectSummary = { id: p.id, name: p.name, updatedAt: p.updatedAt, status: p.status };
  const next = [summary, ...idx.filter((x) => x.id !== p.id)];
  await set(INDEX, next, store);
}

export async function deleteProject(id: string): Promise<void> {
  if (!store) return;
  await del(`p:${id}`, store);
  const idx = (await get<ProjectSummary[]>(INDEX, store)) ?? [];
  await set(INDEX, idx.filter((x) => x.id !== id), store);
}

interface SeedEntry {
  id: string;
  version: number;
  file: string;
  name: string;
  /** The snapshot's source project: a local copy not changed since then may be replaced by the snapshot. */
  replaceIfNotNewerThan?: number;
}

const SEEDED = 'seeded';

/**
 * Projects published with the app (public/seed/index.json), ready to open on any device. Each version is added to
 * this browser once. A project that already exists here is replaced only when it has not been changed since the
 * snapshot was taken (or since an earlier seed was added), so local work is never overwritten. A seeded project the
 * user deletes stays deleted. Returns true when the project list changed.
 */
export async function seedProjects(): Promise<boolean> {
  if (!store) return false;
  let list: SeedEntry[];
  try {
    const r = await fetch('/seed/index.json', { cache: 'no-cache' });
    if (!r.ok) return false;
    list = await r.json();
  } catch {
    return false;
  }
  if (!Array.isArray(list)) return false;
  const done = new Set((await get<string[]>(SEEDED, store)) ?? []);
  let changed = false;
  for (const s of list) {
    const key = `${s.id}@${s.version}`;
    if (done.has(key)) continue;
    try {
      const existing = await get<Project>(`p:${s.id}`, store);
      const replaceable =
        !existing ||
        (s.replaceIfNotNewerThan !== undefined && existing.updatedAt <= s.replaceIfNotNewerThan) ||
        (existing.seed !== undefined && existing.updatedAt <= existing.seed.at);
      if (replaceable) {
        const res = await fetch(`/seed/${encodeURIComponent(s.file)}`);
        if (!res.ok) continue;
        const at = Date.now();
        await saveProject(migrateProject({ ...((await res.json()) as Project), updatedAt: at, seed: { version: s.version, at } }));
        changed = true;
      }
      done.add(key);
      await set(SEEDED, [...done], store);
    } catch {
      // Try again on the next visit.
    }
  }
  return changed;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
